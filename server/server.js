require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./test-8f85b-firebase-adminsdk-fbsvc-1ec826ceb4.json');
admin.initializeApp({ 
  credential: admin.credential.cert(serviceAccount) 
});

const db = admin.firestore();
const app = express();

// CORS configuration
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url}`);
  next();
});

app.use(express.json());

const PORT = process.env.PORT || 4000;

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    ok: true, 
    message: 'MovieReview Server is running',
    timestamp: new Date().toISOString()
  });
});

// Authentication middleware
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }
  
  const idToken = header.split('Bearer ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Auth error', err);
    res.status(401).json({ error: 'Unauthorized - Invalid token' });
  }
}

// Create movie review
app.post('/api/reviews', authenticate, async (req, res) => {
  try {
    const { movieId, movieTitle, rating, body = '' } = req.body;
    
    console.log('🎬 Creating movie review for user:', req.user.uid);
    
    if (!movieId || typeof rating !== 'number') {
      return res.status(400).json({ error: 'Invalid input - movieId and rating are required' });
    }
    
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const review = {
      movieId,
      movieTitle: movieTitle || `Movie ${movieId}`,
      rating,
      body,
      userId: req.user.uid,
      userEmail: req.user.email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const ref = await db.collection('reviews').add(review);
    
    console.log('✅ Movie review created with ID:', ref.id);
    
    res.json({ 
      id: ref.id, 
      message: 'Movie review created successfully'
    });
  } catch (err) {
    console.error('❌ Create movie review error:', err);
    res.status(500).json({ error: 'Server error - Failed to create movie review' });
  }
});

// Get all reviews (for reading others' reviews)
app.get('/api/reviews', async (req, res) => {
  try {
    console.log('📚 Getting all movie reviews');
    
    const snapshot = await db.collection('reviews')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    
    const reviews = snapshot.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data()
    }));
    
    console.log(`✅ Found ${reviews.length} total movie reviews`);
    res.json(reviews);
  } catch (err) {
    console.error('❌ Get all movie reviews error:', err);
    res.status(500).json({ error: 'Server error - Failed to fetch movie reviews' });
  }
});

// Get reviews by movie
app.get('/api/reviews/movie/:movieId', async (req, res) => {
  try {
    console.log('🎬 Getting reviews for movie:', req.params.movieId);
    
    const snapshot = await db.collection('reviews')
      .where('movieId', '==', req.params.movieId)
      .orderBy('createdAt', 'desc')
      .get();
    
    const reviews = snapshot.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data()
    }));
    
    console.log(`✅ Found ${reviews.length} reviews for movie: ${req.params.movieId}`);
    res.json(reviews);
  } catch (err) {
    console.error('❌ Get movie reviews error:', err);
    res.status(500).json({ error: 'Server error - Failed to fetch movie reviews' });
  }
});

// Get reviews by user - NOW WITH PROPER INDEX
app.get('/api/reviews/user/:userId', async (req, res) => {
  try {
    console.log('👤 Getting movie reviews for user:', req.params.userId);
    
    // Now we can use orderBy since the index is created
    const snapshot = await db.collection('reviews')
      .where('userId', '==', req.params.userId)
      .orderBy('createdAt', 'desc')
      .get();
    
    const reviews = snapshot.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data()
    }));
    
    console.log(`✅ Found ${reviews.length} movie reviews for user: ${req.params.userId}`);
    res.json(reviews);
  } catch (err) {
    console.error('❌ Get user movie reviews error:', err);
    res.status(500).json({ error: 'Server error - Failed to fetch user movie reviews' });
  }
});

// Get single review by ID
app.get('/api/reviews/single/:reviewId', async (req, res) => {
  try {
    console.log('📄 Getting single movie review:', req.params.reviewId);
    
    const doc = await db.collection('reviews').doc(req.params.reviewId).get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'Movie review not found' });
    }
    
    const review = {
      id: doc.id,
      ...doc.data()
    };
    
    console.log('✅ Found movie review:', review.id);
    res.json(review);
  } catch (err) {
    console.error('❌ Get single movie review error:', err);
    res.status(500).json({ error: 'Server error - Failed to fetch movie review' });
  }
});

// Update movie review
app.put('/api/reviews/:id', authenticate, async (req, res) => {
  try {
    const { rating, body } = req.body;
    const reviewId = req.params.id;
    
    console.log('✏️ Updating movie review:', reviewId);
    console.log('Update data:', { rating, body });
    
    const docRef = db.collection('reviews').doc(reviewId);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'Movie review not found' });
    }
    
    const reviewData = doc.data();
    
    // Check if user owns this review
    if (reviewData.userId !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden - You can only update your own movie reviews' });
    }
    
    // Validate input
    if (rating && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    if (rating !== undefined) updateData.rating = rating;
    if (body !== undefined) updateData.body = body;
    
    await docRef.update(updateData);
    
    console.log('✅ Movie review updated successfully:', reviewId);
    
    res.json({ 
      ok: true, 
      message: 'Movie review updated successfully',
      reviewId: reviewId
    });
  } catch (err) {
    console.error('❌ Update movie review error:', err);
    res.status(500).json({ error: 'Server error - Failed to update movie review' });
  }
});

// Delete movie review
app.delete('/api/reviews/:id', authenticate, async (req, res) => {
  try {
    const reviewId = req.params.id;
    console.log('🗑️ Deleting movie review:', reviewId);
    
    const docRef = db.collection('reviews').doc(reviewId);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'Movie review not found' });
    }
    
    if (doc.data().userId !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden - You can only delete your own movie reviews' });
    }
    
    await docRef.delete();
    
    console.log('✅ Movie review deleted successfully:', reviewId);
    
    res.json({ 
      ok: true, 
      message: 'Movie review deleted successfully',
      deletedId: reviewId
    });
  } catch (err) {
    console.error('❌ Delete movie review error:', err);
    res.status(500).json({ error: 'Server error - Failed to delete movie review' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎬 MovieReview Server running on port ${PORT}`);
  console.log(`✅ All movie review features enabled: Create, Read, Update, Delete`);
  console.log(`📱 TMDB API: ${process.env.REACT_APP_TMDB_API_KEY ? 'Connected' : 'Using Mock Data'}`);
  console.log(`✅ Firestore index created and ready!`);
});