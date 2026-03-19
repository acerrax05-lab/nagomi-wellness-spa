  const express = require('express');
  const router = express.Router();
  const Review = require('../models/Review');
  const Service = require('../models/Service');

  // ============================================
  // PUBLIC: SUBMIT REVIEW
  // ============================================
  router.post('/', async (req, res) => {
    try {
      console.log('📝 Review submission received:', {
        user: req.body.user,
        service: req.body.service,
        rating: req.body.rating
      });
      
      const { user, email, service, rating, comment } = req.body;
      
      // Validation
      if (!user || !user.name || !service || !rating || !comment) {
        console.error('❌ Missing required fields');
        return res.status(400).json({ 
          success: false,
          msg: 'Please provide all required fields (name, service, rating, comment)' 
        });
      }
      
      if (rating < 1 || rating > 5) {
        console.error('❌ Invalid rating:', rating);
        return res.status(400).json({ 
          success: false,
          msg: 'Rating must be between 1 and 5' 
        });
      }
      
      if (comment.length < 20) {
        console.error('❌ Comment too short:', comment.length);
        return res.status(400).json({
          success: false,
          msg: 'Review must be at least 20 characters'
        });
      }
      
      // ✅ VERIFY SERVICE EXISTS
      const serviceExists = await Service.findById(service);
      if (!serviceExists) {
        console.error('❌ Service not found:', service);
        return res.status(404).json({
          success: false,
          msg: 'Service not found'
        });
      }
      
      console.log('✅ Service verified:', serviceExists.name);
      
      // Create review
      const review = new Review({
        guestName: user.name.trim(),
        guestEmail: email && email.trim() ? email.trim() : null,
        service: service,
        rating: parseInt(rating),
        comment: comment.trim(),
        status: 'approved',
        isGuest: true,
        hidden: false
      });
      
      await review.save();
      
      console.log(`✅ Review saved successfully: ${review._id}`);
      
      res.json({
        success: true,
        msg: 'Review submitted successfully! It will appear after admin approval.',
        review: {
          _id: review._id,
          status: review.status,
          service: {
            _id: serviceExists._id,
            name: serviceExists.name
          }
        }
      });
      
    } catch (err) {
      console.error('❌ Error submitting review:', err);
      res.status(500).json({ 
        success: false,
        msg: 'Error submitting review. Please try again.',
        error: err.message 
      });
    }
  });

  // ============================================
  // ADMIN: GET ALL REVIEWS
  // ============================================
  router.get('/admin/all', async (req, res) => {
    try {
      console.log('📋 Fetching all reviews for admin...');
      
      const { status, limit = 100 } = req.query;
      
      const query = status ? { status } : {};
      
      // ✅ CRITICAL: Populate service field
      const reviews = await Review.find(query)
        .populate('service', 'name category')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .lean();
      
      console.log(`✅ Found ${reviews.length} reviews for admin`);
      
      // ✅ Format with safe null checks
      const formatted = reviews.map(review => ({
        _id: review._id,
        user: {
          name: review.guestName || 'Guest',
          email: review.guestEmail || 'No email'
        },
        service: review.service || { name: 'Service Not Found' },
        rating: review.rating,
        comment: review.comment,
        status: review.status,
        hidden: review.hidden,
        isGuest: review.isGuest || false,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt
      }));
      
      console.log('✅ Sending formatted reviews to admin');
      res.json({ reviews: formatted });
      
    } catch (err) {
      console.error('❌ Error fetching admin reviews:', err);
      res.status(500).json({ 
        success: false,
        msg: 'Error fetching reviews', 
        error: err.message 
      });
    }
  });

  // ============================================
  // ADMIN: GET STATS
  // ============================================
  router.get('/admin/stats', async (req, res) => {
    try {
      const approvedReviews = await Review.find({ status: 'approved' }).lean();
      
      const stats = {
        total: await Review.countDocuments(),
        pending: await Review.countDocuments({ status: 'pending' }),
        approved: approvedReviews.length,
        rejected: await Review.countDocuments({ status: 'rejected' }),
        averageRating: 0
      };
      
      if (approvedReviews.length > 0) {
        const totalRating = approvedReviews.reduce((sum, r) => sum + r.rating, 0);
        stats.averageRating = parseFloat((totalRating / approvedReviews.length).toFixed(1));
      }
      
      res.json(stats);
      
    } catch (err) {
      console.error('❌ Error fetching admin stats:', err);
      res.status(500).json({ msg: 'Error fetching stats' });
    }
  });

  // ============================================
  // ADMIN: APPROVE REVIEW
  // ============================================
  router.put('/:id/approve', async (req, res) => {
    try {
      const review = await Review.findByIdAndUpdate(
        req.params.id,
        { 
          status: 'approved',
          updatedAt: new Date()
        },
        { new: true }
      ).populate('service', 'name');
      
      if (!review) {
        return res.status(404).json({ msg: 'Review not found' });
      }
      
      console.log(`✅ Review approved: ${review._id}`);
      res.json({ msg: 'Review approved', review });
      
    } catch (err) {
      console.error('❌ Error approving review:', err);
      res.status(500).json({ msg: 'Error approving review' });
    }
  });

  // ============================================
  // ADMIN: REJECT REVIEW
  // ============================================
  router.put('/:id/reject', async (req, res) => {
    try {
      const review = await Review.findByIdAndUpdate(
        req.params.id,
        { 
          status: 'rejected',
          updatedAt: new Date()
        },
        { new: true }
      );
      
      if (!review) {
        return res.status(404).json({ msg: 'Review not found' });
      }
      
      console.log(`✅ Review rejected: ${review._id}`);
      res.json({ msg: 'Review rejected', review });
      
    } catch (err) {
      console.error('❌ Error rejecting review:', err);
      res.status(500).json({ msg: 'Error rejecting review' });
    }
  });

  // ============================================
  // ADMIN: TOGGLE VISIBILITY
  // ============================================
  router.put('/:id/toggle-visibility', async (req, res) => {
    try {
      const review = await Review.findById(req.params.id);
      
      if (!review) {
        return res.status(404).json({ msg: 'Review not found' });
      }
      
      review.hidden = !review.hidden;
      review.updatedAt = new Date();
      await review.save();
      
      console.log(`✅ Review visibility toggled: ${review._id}, hidden: ${review.hidden}`);
      res.json({ 
        msg: review.hidden ? 'Review hidden' : 'Review visible',
        review 
      });
      
    } catch (err) {
      console.error('❌ Error toggling visibility:', err);
      res.status(500).json({ msg: 'Error updating review' });
    }
  });

  router.get('/public', async (req, res) => {
    try {
      const limit  = Math.min(parseInt(req.query.limit)  || 12, 50);
      const page   = Math.max(parseInt(req.query.page)   || 1,  1);
      const rating = parseInt(req.query.rating) || null;
      const skip   = (page - 1) * limit;

      // hidden: { $ne: true } matches both hidden:false AND docs where the field
      // is missing/undefined — fixes the "stars not showing" bug.
      const match = { status: 'approved', hidden: { $ne: true } };
      if (rating && rating >= 1 && rating <= 5) match.rating = rating;

      const [reviews, total] = await Promise.all([
        Review.find(match)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('service', 'name category'),
        Review.countDocuments(match),
      ]);

      res.json({
        reviews,
        total,
        page,
        pages: Math.ceil(total / limit),
      });
    } catch (err) {
      console.error('GET /reviews/public error:', err);
      res.status(500).json({ msg: 'Server error' });
    }
  });

  // ── GET /api/reviews/stats ────────────────────────────────────────────────────
  // Returns overall rating average + per-star counts.
  // Used by homepage summary block and the "All Reviews" modal.
  //
  // Response shape: { averageRating, approved, ratingBreakdown: {5,4,3,2,1} }
  router.get('/stats', async (req, res) => {
    try {
      const agg = await Review.aggregate([
        { $match: { status: 'approved', hidden: { $ne: true } } },
        {
          $group: {
            _id:   null,
            avg:   { $avg: '$rating' },
            total: { $sum: 1 },
            star5: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
            star4: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
            star3: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
            star2: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
            star1: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
          },
        },
      ]);

      if (!agg.length) {
        return res.json({
          averageRating:   0,
          approved:        0,
          ratingBreakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
        });
      }

      const r = agg[0];
      res.json({
        averageRating:   parseFloat(r.avg.toFixed(1)),
        approved:        r.total,
        ratingBreakdown: {
          5: r.star5,
          4: r.star4,
          3: r.star3,
          2: r.star2,
          1: r.star1,
        },
      });
    } catch (err) {
      console.error('GET /reviews/stats error:', err);
      res.status(500).json({ msg: 'Server error' });
    }
  });

  // ============================================
  // ADMIN: DELETE REVIEW
  // ============================================
  router.delete('/:id', async (req, res) => {
    try {
      const review = await Review.findByIdAndDelete(req.params.id);
      
      if (!review) {
        return res.status(404).json({ msg: 'Review not found' });
      }
      
      console.log(`✅ Review deleted: ${req.params.id}`);
      res.json({ msg: 'Review deleted successfully' });
      
    } catch (err) {
      console.error('❌ Error deleting review:', err);
      res.status(500).json({ msg: 'Error deleting review' });
    }
  });

  module.exports = router;