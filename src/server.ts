import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Supabase client - support both naming conventions
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Required: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
  console.error('Required: SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

// Extended Request type with user
interface AuthRequest extends Request {
  user?: any;
}

// Auth middleware
async function authenticateUser(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

// Types
interface DailyLimits {
  [key: string]: number;
}

const DAILY_LIMITS: DailyLimits = {
  free: 2,
  starter: 10,
  pro: 25,
  unlimited: 100
};

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    supabase: !!supabaseUrl,
    sunoApi: !!process.env.SUNO_API_KEY,
    environment: process.env.NODE_ENV
  });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'MusicGen AI API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      generate: '/api/generate-music',
      taskStatus: '/api/task/:taskId',
      tracks: '/api/tracks',
      profile: '/api/profile',
      feed: '/api/feed'
    }
  });
});

// Suno API Proxy - Generate Music
app.post('/api/generate-music', authenticateUser, async (req: AuthRequest, res: Response) => {
  try {
    const { genre, mood, prompt, duration, isInstrumental, customLyrics } = req.body;

    console.log('🎵 Generate music request:', {
      userId: req.user!.id,
      genre,
      mood,
      duration
    });

    // Get user and check credits
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.user!.id)
      .single();

    if (userError || !user) {
      console.error('User not found:', userError);
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    // Check daily limit
    const limit = DAILY_LIMITS[user.current_plan] || 2;

    if (user.used_points_today >= limit) {
      console.log('❌ Daily limit reached for user:', req.user!.id);
      res.status(403).json({
        error: 'Daily limit reached',
        limit,
        used: user.used_points_today
      });
      return;
    }

    // Check total points
    if (user.total_points <= 0) {
      console.log('❌ No credits remaining for user:', req.user!.id);
      res.status(403).json({ error: 'No credits remaining' });
      return;
    }

    // Build Suno API request
    const fullPrompt = `${genre} music with ${mood} vibes. ${prompt || ''}`.trim();
    const style = `${genre}, ${mood}`;
    const title = `${genre} ${mood} Track`;

    console.log('📡 Calling Suno API:', { genre, mood, instrumental: isInstrumental });

    // Call Suno API
    const sunoBaseUrl = process.env.SUNO_BASE_URL || process.env.SUNO_API_BASE_URL;
    const sunoApiResponse = await axios.post(
      `${sunoBaseUrl}/api/v1/generate`,
      {
        customMode: true,
        instrumental: isInstrumental,
        model: 'V4_5', // Using V4_5 for best quality (can upgrade to V5)
        callBackUrl: '', // Can add webhook URL here if needed
        prompt: customLyrics?.trim() || fullPrompt,
        style: style,
        title: title
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.SUNO_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const taskId = sunoApiResponse.data?.data?.taskId;

    if (!taskId) {
      throw new Error('No task ID returned from Suno API');
    }

    console.log('✅ Suno API task created:', taskId);

    // Deduct credit
    const { error: updateError } = await supabase
      .from('users')
      .update({
        total_points: user.total_points - 1,
        used_points_today: user.used_points_today + 1,
        total_generations: user.total_generations + 1
      })
      .eq('id', req.user!.id);

    if (updateError) {
      console.error('Failed to deduct credit:', updateError);
    }

    res.json({
      success: true,
      task_id: taskId,
      remaining_credits: user.total_points - 1
    });

  } catch (error: any) {
    console.error('❌ Generate music error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Generation failed',
      message: error.response?.data?.msg || error.message
    });
  }
});

// Check task status
app.get('/api/task/:taskId', authenticateUser, async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params;

    console.log('📊 Checking task status:', taskId);

    const sunoBaseUrl = process.env.SUNO_BASE_URL || process.env.SUNO_API_BASE_URL;
    const response = await axios.get(
      `${sunoBaseUrl}/api/v1/generate/record-info?taskId=${taskId}`,
      {
        headers: { 'Authorization': `Bearer ${process.env.SUNO_API_KEY}` },
        timeout: 10000
      }
    );

    // Transform Suno response to match expected format
    const sunoData = response.data;

    res.json({
      code: sunoData.code,
      message: sunoData.msg || 'Success',
      data: {
        taskId: taskId,
        status: sunoData.data?.status || 'PENDING',
        output: sunoData.data?.response ? {
          audioUrl: sunoData.data.response.sunoData?.[0]?.audioUrl,
          streamAudioUrl: sunoData.data.response.sunoData?.[0]?.streamAudioUrl,
          imageUrl: sunoData.data.response.sunoData?.[0]?.imageUrl,
          title: sunoData.data.response.sunoData?.[0]?.title,
          lyrics: sunoData.data.response.sunoData?.[0]?.lyrics,
          duration: sunoData.data.response.sunoData?.[0]?.duration,
          // Include second song as well
          songs: sunoData.data.response.sunoData || []
        } : null
      }
    });
  } catch (error: any) {
    console.error('Task status error:', error.message);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// Save track
app.post('/api/tracks', authenticateUser, async (req: AuthRequest, res: Response) => {
  try {
    const { title, genre, mood, prompt, duration, audio_url, image_url, task_id } = req.body;

    console.log('💾 Saving track:', { userId: req.user!.id, title });

    const { data, error } = await supabase
      .from('tracks')
      .insert({
        user_id: req.user!.id,
        title,
        genre,
        mood,
        prompt: prompt || '',
        duration,
        audio_url,
        image_url,
        task_id,
        tags: [genre?.toLowerCase(), mood?.toLowerCase()].filter(Boolean)
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to save track:', error);
      throw error;
    }

    console.log('✅ Track saved:', data.id);
    res.json({ success: true, track: data });

  } catch (error: any) {
    console.error('Save track error:', error);
    res.status(500).json({ error: 'Failed to save track' });
  }
});

// Get user tracks
app.get('/api/tracks', authenticateUser, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('tracks')
      .select('*')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ tracks: data || [] });
  } catch (error) {
    console.error('Fetch tracks error:', error);
    res.status(500).json({ error: 'Failed to fetch tracks' });
  }
});

// Get user profile
app.get('/api/profile', authenticateUser, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.user!.id)
      .single();

    if (error) throw error;

    res.json({ user: data });
  } catch (error) {
    console.error('Fetch profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
app.patch('/api/profile', authenticateUser, async (req: AuthRequest, res: Response) => {
  try {
    const updates = { ...req.body };

    // Don't allow changing these fields
    delete updates.id;
    delete updates.email;
    delete updates.total_points;
    delete updates.used_points_today;

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.user!.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ user: data });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Public feed (no auth required)
app.get('/api/feed', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('published_tracks')
      .select(`
        id,
        published_at,
        tracks (
          id, title, genre, mood, audio_url, image_url, plays, likes,
          users (display_name)
        )
      `)
      .order('published_at', { ascending: false })
      .limit(25);

    if (error) throw error;

    res.json({ tracks: data || [] });
  } catch (error) {
    console.error('Fetch feed error:', error);
    res.status(500).json({ error: 'Failed to fetch feed' });
  }
});

// Publish track
app.post('/api/tracks/:trackId/publish', authenticateUser, async (req: AuthRequest, res: Response) => {
  try {
    const { trackId } = req.params;

    // Verify ownership
    const { data: track } = await supabase
      .from('tracks')
      .select('user_id')
      .eq('id', trackId)
      .single();

    if (track?.user_id !== req.user!.id) {
      res.status(403).json({ error: 'Not your track' });
      return;
    }

    // Publish
    await supabase
      .from('tracks')
      .update({ is_published: true })
      .eq('id', trackId);

    await supabase
      .from('published_tracks')
      .insert({ track_id: trackId, user_id: req.user!.id });

    res.json({ success: true });
  } catch (error) {
    console.error('Publish track error:', error);
    res.status(500).json({ error: 'Failed to publish' });
  }
});

// Like/Unlike track
app.post('/api/tracks/:trackId/like', authenticateUser, async (req: AuthRequest, res: Response) => {
  try {
    const { trackId } = req.params;

    // Check if already liked
    const { data: existing } = await supabase
      .from('track_likes')
      .select('*')
      .eq('user_id', req.user!.id)
      .eq('track_id', trackId)
      .single();

    if (existing) {
      // Unlike
      await supabase
        .from('track_likes')
        .delete()
        .eq('user_id', req.user!.id)
        .eq('track_id', trackId);

      await supabase.rpc('decrement_likes', { track_id: trackId });

      res.json({ liked: false });
    } else {
      // Like
      await supabase
        .from('track_likes')
        .insert({ user_id: req.user!.id, track_id: trackId });

      await supabase.rpc('increment_likes', { track_id: trackId });

      res.json({ liked: true });
    }
  } catch (error) {
    console.error('Toggle like error:', error);
    res.status(500).json({ error: 'Failed to toggle like' });
  }
});

// Delete track
app.delete('/api/tracks/:trackId', authenticateUser, async (req: AuthRequest, res: Response) => {
  try {
    const { trackId } = req.params;

    // Verify ownership
    const { data: track } = await supabase
      .from('tracks')
      .select('user_id')
      .eq('id', trackId)
      .single();

    if (track?.user_id !== req.user!.id) {
      res.status(403).json({ error: 'Not your track' });
      return;
    }

    // Delete
    await supabase
      .from('tracks')
      .delete()
      .eq('id', trackId);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete track error:', error);
    res.status(500).json({ error: 'Failed to delete track' });
  }
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 MusicGen API server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔗 Supabase: ${supabaseUrl}`);
  console.log(`🎵 Suno API: ${process.env.SUNO_BASE_URL || process.env.SUNO_API_BASE_URL}`);
  console.log(`✅ Server ready to accept requests`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});
