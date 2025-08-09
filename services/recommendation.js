const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configure Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

/**
 * Get manga/manhwa recommendations based on user preferences
 */
async function getRecommendations(titles, preferences, genres, exclude) {
  try {
    // Build prompt for Gemini
    const prompt = `
      As a manga and manhwa expert, please recommend 5 manga or manhwa based on the following:
      
      Titles I've enjoyed: ${Array.isArray(titles) ? titles.join(', ') : titles}
      ${preferences ? `What I like about them: ${preferences}` : ''}
      ${genres ? `Preferred genres: ${genres}` : ''}
      ${exclude ? `Please exclude: ${exclude}` : ''}
      
      Format your response as JSON with this structure:
      {
        "recommendations": [
          {
            "title": "Title",
            "creator": "Author/Artist",
            "type": "Manga or Manhwa",
            "genres": ["Genre1", "Genre2"],
            "description": "Brief description",
            "similarTo": "Most similar to which title I mentioned",
            "whyRecommended": "Why you're recommending this based on my preferences"
          }
        ]
      }
      
      Only return the JSON without any other text. Ensure all manga/manhwa recommendations are real, existing titles.
    `;
    
    // Generate recommendations
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    
    // Parse JSON from response
    let jsonResponse;
    try {
      // Extract JSON if it's wrapped in markdown code blocks
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/);
      const jsonString = jsonMatch ? jsonMatch[1] : text;
      jsonResponse = JSON.parse(jsonString);
    } catch (error) {
      console.error('Failed to parse JSON:', error);
      throw new Error('Failed to generate proper recommendations');
    }
    
    return jsonResponse;
    
  } catch (error) {
    console.error('Recommendation error:', error);
    throw error;
  }
}

module.exports = {
  getRecommendations
};