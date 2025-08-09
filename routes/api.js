const express = require('express');
const router = express.Router();
const recommendationService = require('../services/recommendation');

// Route for manga recommendations
router.post('/recommend', async (req, res, next) => {
  try {
    const { titles, preferences, genres, exclude } = req.body;
    
    if (!titles || titles.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No manga/manhwa titles provided' 
      });
    }
    
    const recommendations = await recommendationService.getRecommendations(
      titles, preferences, genres, exclude
    );
    
    return res.json(recommendations);
    
  } catch (error) {
    next(error);
  }
});

module.exports = router;