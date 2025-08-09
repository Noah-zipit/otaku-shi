const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting helper
const RATE_LIMIT_DELAY = 1000; // Jikan API has a rate limit of 1 request per second
const queue = [];
let isProcessing = false;

function enqueueRequest(requestFn) {
  return new Promise((resolve, reject) => {
    queue.push({ requestFn, resolve, reject });
    
    if (!isProcessing) {
      processQueue();
    }
  });
}

async function processQueue() {
  if (queue.length === 0) {
    isProcessing = false;
    return;
  }
  
  isProcessing = true;
  const { requestFn, resolve, reject } = queue.shift();
  
  try {
    const result = await requestFn();
    resolve(result);
  } catch (error) {
    reject(error);
  }
  
  // Wait before processing next request
  setTimeout(processQueue, RATE_LIMIT_DELAY);
}

// API endpoint for recommendations
app.post('/api/recommend', async (req, res) => {
  try {
    const { titles, genres, exclude, mediaType = 'manga' } = req.body;
    
    if (!titles || titles.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one title' });
    }
    
    console.log(`Getting ${mediaType} recommendations based on: ${titles.join(', ')}`);
    
    // Handle different media types
    if (mediaType === 'anime') {
      return await getAnimeRecommendations(titles, genres, exclude, res);
    } else if (mediaType === 'manhwa') {
      return await getManhwaRecommendations(titles, genres, exclude, res);
    } else {
      return await getMangaRecommendations(titles, genres, exclude, res);
    }
    
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ 
      error: 'Failed to get recommendations',
      details: error.message
    });
  }
});

// Function to get manga recommendations
async function getMangaRecommendations(titles, genres, exclude, res) {
  try {
    // Search for the first manga by title
    const searchResponse = await enqueueRequest(() => 
      axios.get(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(titles[0])}&limit=1`)
    );
    
    if (!searchResponse.data.data.length) {
      // Try another title if the first one fails
      if (titles.length > 1) {
        const secondSearchResponse = await enqueueRequest(() => 
          axios.get(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(titles[1])}&limit=1`)
        );
        
        if (!secondSearchResponse.data.data.length) {
          return res.status(404).json({ error: `Could not find manga "${titles[0]}" or "${titles[1]}"` });
        }
        
        var mangaId = secondSearchResponse.data.data[0].mal_id;
        var baseManga = secondSearchResponse.data.data[0];
      } else {
        return res.status(404).json({ error: `Could not find manga "${titles[0]}"` });
      }
    } else {
      var mangaId = searchResponse.data.data[0].mal_id;
      var baseManga = searchResponse.data.data[0];
    }
    
    // Get recommendations based on this manga
    const recommendationsResponse = await enqueueRequest(() => 
      axios.get(`https://api.jikan.moe/v4/manga/${mangaId}/recommendations`)
    );
    
    let recommendations = [];
    
    // Process recommendations if available
    if (recommendationsResponse.data.data.length > 0) {
      // Get initial recommendations
      const initialRecs = recommendationsResponse.data.data.slice(0, 8);
      
      // Fetch detailed info for each recommendation
      recommendations = await Promise.all(initialRecs.map(async (rec) => {
        try {
          // Get full manga details
          const mangaDetails = await enqueueRequest(() => 
            axios.get(`https://api.jikan.moe/v4/manga/${rec.entry.mal_id}`)
          );
          
          const manga = mangaDetails.data.data;
          
          // Apply genre filter if specified
          if (genres && genres.length > 0) {
            const mangaGenres = manga.genres.map(g => g.name.toLowerCase());
            const filterGenres = genres.map(g => g.toLowerCase());
            
            if (!filterGenres.some(g => mangaGenres.includes(g))) {
              return null; // Skip this recommendation
            }
          }
          
          // Apply exclusion filter if specified
          if (exclude && exclude.length > 0) {
            const mangaGenres = manga.genres.map(g => g.name.toLowerCase());
            const excludeGenres = exclude.map(g => g.toLowerCase());
            
            if (excludeGenres.some(g => mangaGenres.includes(g))) {
              return null; // Skip this recommendation
            }
          }
          
          return {
            title: manga.title,
            creator: manga.authors.map(a => a.name).join(', '),
            type: manga.type || "Manga",
            genres: manga.genres.map(g => g.name),
            description: manga.synopsis || "No description available",
            similarTo: titles[0],
            whyRecommended: `Recommended by ${rec.votes} MyAnimeList users who also enjoyed ${titles[0]}`,
            image: manga.images.jpg.image_url,
            url: manga.url,
            score: manga.score,
            chapters: manga.chapters
          };
        } catch (error) {
          console.error(`Error fetching details for ${rec.entry.title}:`, error);
          return null;
        }
      }));
      
      // Filter out null values (from genre filtering or errors)
      recommendations = recommendations.filter(r => r !== null);
    }
    
    // If we don't have enough recommendations, add some based on genre
    if (recommendations.length < 5) {
      console.log("Not enough recommendations, adding genre-based recommendations");
      
      // Get manga genres to base recommendations on
      const mangaGenres = baseManga.genres || [];
      
      if (mangaGenres.length > 0) {
        // Use the first genre to find similar manga
        const genreId = mangaGenres[0].mal_id;
        
        const genreRecsResponse = await enqueueRequest(() => 
          axios.get(`https://api.jikan.moe/v4/manga?genres=${genreId}&order_by=score&sort=desc&limit=5`)
        );
        
        // Add genre-based recommendations
        const genreRecs = genreRecsResponse.data.data
          .filter(m => m.mal_id !== mangaId) // Filter out the original manga
          .map(manga => ({
            title: manga.title,
            creator: manga.authors?.map(a => a.name).join(', ') || "Unknown",
            type: manga.type || "Manga",
            genres: manga.genres.map(g => g.name),
            description: manga.synopsis || "No description available",
            similarTo: titles[0],
            whyRecommended: `Shares the ${mangaGenres[0].name} genre with ${titles[0]}`,
            image: manga.images.jpg.image_url,
            url: manga.url,
            score: manga.score,
            chapters: manga.chapters
          }));
        
        recommendations = [...recommendations, ...genreRecs];
      }
    }
    
    // If still not enough, add popular manga
    if (recommendations.length < 5) {
      console.log("Still not enough recommendations, adding popular manga");
      
      const topMangaResponse = await enqueueRequest(() => 
        axios.get('https://api.jikan.moe/v4/top/manga?limit=5')
      );
      
      const topRecs = topMangaResponse.data.data
        .filter(m => m.mal_id !== mangaId)
        .map(manga => ({
          title: manga.title,
          creator: manga.authors?.map(a => a.name).join(', ') || "Unknown",
          type: manga.type || "Manga",
          genres: manga.genres.map(g => g.name),
          description: manga.synopsis || "No description available",
          similarTo: titles[0],
          whyRecommended: "This is a highly rated manga on MyAnimeList",
          image: manga.images.jpg.image_url,
          url: manga.url,
          score: manga.score,
          chapters: manga.chapters
        }));
      
      recommendations = [...recommendations, ...topRecs];
    }
    
    // Return final recommendations (limit to 5)
    return res.json({ 
      recommendations: recommendations.slice(0, 5),
      baseTitle: baseManga.title,
      mediaType: 'manga'
    });
  } catch (error) {
    console.error('Error in manga recommendations:', error);
    throw error;
  }
}

// Function to get manhwa recommendations
async function getManhwaRecommendations(titles, genres, exclude, res) {
  try {
    // Search for the first manhwa by title
    const searchResponse = await enqueueRequest(() => 
      axios.get(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(titles[0])}&limit=5`)
    );
    
    // Find a Korean manga (manhwa) in results, or use first result
    let manhwa = null;
    let baseTitle = titles[0];
    
    if (searchResponse.data.data.length > 0) {
      // Try to find a Korean manga/manhwa in the results
      manhwa = searchResponse.data.data.find(m => 
        m.title.toLowerCase().includes('manhwa') || 
        (m.background && m.background.toLowerCase().includes('korean')) ||
        (m.demographics && m.demographics.some(d => d.name === 'Manhwa'))
      );
      
      // If no specific manhwa found, use the first result
      if (!manhwa) {
        manhwa = searchResponse.data.data[0];
      }
    } else if (titles.length > 1) {
      // Try another title
      const secondSearchResponse = await enqueueRequest(() => 
        axios.get(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(titles[1])}&limit=5`)
      );
      
      if (secondSearchResponse.data.data.length > 0) {
        manhwa = secondSearchResponse.data.data[0];
        baseTitle = titles[1];
      } else {
        return res.status(404).json({ error: `Could not find manhwa with these titles` });
      }
    } else {
      return res.status(404).json({ error: `Could not find manhwa "${titles[0]}"` });
    }
    
    // Get popular manhwa (Korean comics)
    const manhwaResponse = await enqueueRequest(() => 
      axios.get(`https://api.jikan.moe/v4/manga?q=manhwa&order_by=score&sort=desc&limit=10`)
    );
    
    let recommendations = [];
    
    if (manhwaResponse.data.data.length > 0) {
      // Filter out the base manhwa if it's in the results
      const manhwaList = manhwaResponse.data.data.filter(m => m.mal_id !== manhwa.mal_id);
      
      // Apply genre filters if needed
      let filteredManhwa = manhwaList;
      
      if (genres && genres.length > 0) {
        const filterGenres = genres.map(g => g.toLowerCase());
        
        filteredManhwa = manhwaList.filter(m => {
          const mangaGenres = m.genres.map(g => g.name.toLowerCase());
          return filterGenres.some(g => mangaGenres.includes(g));
        });
      }
      
      if (exclude && exclude.length > 0) {
        const excludeGenres = exclude.map(g => g.toLowerCase());
        
        filteredManhwa = filteredManhwa.filter(m => {
          const mangaGenres = m.genres.map(g => g.name.toLowerCase());
          return !excludeGenres.some(g => mangaGenres.includes(g));
        });
      }
      
      // Create recommendation objects
      recommendations = filteredManhwa.slice(0, 5).map(m => ({
        title: m.title,
        creator: m.authors?.map(a => a.name).join(', ') || "Unknown",
        type: "Manhwa",
        genres: m.genres.map(g => g.name),
        description: m.synopsis || "No description available",
        similarTo: baseTitle,
        whyRecommended: "Popular Korean manhwa with similar appeal",
        image: m.images.jpg.image_url,
        url: m.url,
        score: m.score,
        chapters: m.chapters
      }));
    }
    
    // If not enough recommendations, add top-rated manga that might be manhwa
    if (recommendations.length < 5) {
      const topMangaResponse = await enqueueRequest(() => 
        axios.get('https://api.jikan.moe/v4/top/manga?limit=10')
      );
      
      const topRecs = topMangaResponse.data.data
        .filter(m => m.mal_id !== manhwa.mal_id)
        .slice(0, 5 - recommendations.length)
        .map(m => ({
          title: m.title,
          creator: m.authors?.map(a => a.name).join(', ') || "Unknown",
          type: m.type || "Manga",
          genres: m.genres.map(g => g.name),
          description: m.synopsis || "No description available",
          similarTo: baseTitle,
          whyRecommended: "Highly rated comic you might enjoy",
          image: m.images.jpg.image_url,
          url: m.url,
          score: m.score,
          chapters: m.chapters
        }));
      
      recommendations = [...recommendations, ...topRecs];
    }
    
    // Return final recommendations
    return res.json({ 
      recommendations: recommendations.slice(0, 5),
      baseTitle: manhwa.title,
      mediaType: 'manhwa'
    });
  } catch (error) {
    console.error('Error in manhwa recommendations:', error);
    throw error;
  }
}

// Function to get anime recommendations
async function getAnimeRecommendations(titles, genres, exclude, res) {
  try {
    // Search for the anime by title
    const searchResponse = await enqueueRequest(() => 
      axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(titles[0])}&limit=1`)
    );
    
    if (!searchResponse.data.data.length) {
      // Try another title if the first one fails
      if (titles.length > 1) {
        const secondSearchResponse = await enqueueRequest(() => 
          axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(titles[1])}&limit=1`)
        );
        
        if (!secondSearchResponse.data.data.length) {
          return res.status(404).json({ error: `Could not find anime "${titles[0]}" or "${titles[1]}"` });
        }
        
        var animeId = secondSearchResponse.data.data[0].mal_id;
        var baseAnime = secondSearchResponse.data.data[0];
      } else {
        return res.status(404).json({ error: `Could not find anime "${titles[0]}"` });
      }
    } else {
      var animeId = searchResponse.data.data[0].mal_id;
      var baseAnime = searchResponse.data.data[0];
    }
    
    // Get recommendations based on this anime
    const recommendationsResponse = await enqueueRequest(() => 
      axios.get(`https://api.jikan.moe/v4/anime/${animeId}/recommendations`)
    );
    
    let recommendations = [];
    
    // Process recommendations if available
    if (recommendationsResponse.data.data.length > 0) {
      // Get initial recommendations
      const initialRecs = recommendationsResponse.data.data.slice(0, 8);
      
      // Fetch detailed info for each recommendation
      recommendations = await Promise.all(initialRecs.map(async (rec) => {
        try {
          // Get full anime details
          const animeDetails = await enqueueRequest(() => 
            axios.get(`https://api.jikan.moe/v4/anime/${rec.entry.mal_id}`)
          );
          
          const anime = animeDetails.data.data;
          
          // Apply genre filter if specified
          if (genres && genres.length > 0) {
            const animeGenres = anime.genres.map(g => g.name.toLowerCase());
            const filterGenres = genres.map(g => g.toLowerCase());
            
            if (!filterGenres.some(g => animeGenres.includes(g))) {
              return null; // Skip this recommendation
            }
          }
          
          // Apply exclusion filter if specified
          if (exclude && exclude.length > 0) {
            const animeGenres = anime.genres.map(g => g.name.toLowerCase());
            const excludeGenres = exclude.map(g => g.toLowerCase());
            
            if (excludeGenres.some(g => animeGenres.includes(g))) {
              return null; // Skip this recommendation
            }
          }
          
          return {
            title: anime.title,
            creator: anime.studios.map(s => s.name).join(', '),
            type: anime.type || "TV",
            genres: anime.genres.map(g => g.name),
            description: anime.synopsis || "No description available",
            similarTo: titles[0],
            whyRecommended: `Recommended by ${rec.votes} MyAnimeList users who also enjoyed ${titles[0]}`,
            image: anime.images.jpg.image_url,
            url: anime.url,
            score: anime.score,
            episodes: anime.episodes
          };
        } catch (error) {
          console.error(`Error fetching details for ${rec.entry.title}:`, error);
          return null;
        }
      }));
      
      // Filter out null values (from genre filtering or errors)
      recommendations = recommendations.filter(r => r !== null);
    }
    
    // If we don't have enough recommendations, add some based on genre
    if (recommendations.length < 5) {
      console.log("Not enough recommendations, adding genre-based recommendations");
      
      // Get anime genres to base recommendations on
      const animeGenres = baseAnime.genres || [];
      
      if (animeGenres.length > 0) {
        // Use the first genre to find similar anime
        const genreId = animeGenres[0].mal_id;
        
        const genreRecsResponse = await enqueueRequest(() => 
          axios.get(`https://api.jikan.moe/v4/anime?genres=${genreId}&order_by=score&sort=desc&limit=5`)
        );
        
        // Add genre-based recommendations
        const genreRecs = genreRecsResponse.data.data
          .filter(a => a.mal_id !== animeId) // Filter out the original anime
          .map(anime => ({
            title: anime.title,
            creator: anime.studios?.map(s => s.name).join(', ') || "Unknown",
            type: anime.type || "TV",
            genres: anime.genres.map(g => g.name),
            description: anime.synopsis || "No description available",
            similarTo: titles[0],
            whyRecommended: `Shares the ${animeGenres[0].name} genre with ${titles[0]}`,
            image: anime.images.jpg.image_url,
            url: anime.url,
            score: anime.score,
            episodes: anime.episodes
          }));
        
        recommendations = [...recommendations, ...genreRecs];
      }
    }
    
    // If still not enough, add popular anime
    if (recommendations.length < 5) {
      console.log("Still not enough recommendations, adding popular anime");
      
      const topAnimeResponse = await enqueueRequest(() => 
        axios.get('https://api.jikan.moe/v4/top/anime?limit=5')
      );
      
      const topRecs = topAnimeResponse.data.data
        .filter(a => a.mal_id !== animeId)
        .map(anime => ({
          title: anime.title,
          creator: anime.studios?.map(s => s.name).join(', ') || "Unknown",
          type: anime.type || "TV",
          genres: anime.genres.map(g => g.name),
          description: anime.synopsis || "No description available",
          similarTo: titles[0],
          whyRecommended: "This is a highly rated anime on MyAnimeList",
          image: anime.images.jpg.image_url,
          url: anime.url,
          score: anime.score,
          episodes: anime.episodes
        }));
      
      recommendations = [...recommendations, ...topRecs];
    }
    
    // Return final recommendations (limit to 5)
    return res.json({ 
      recommendations: recommendations.slice(0, 5),
      baseTitle: baseAnime.title,
      mediaType: 'anime'
    });
  } catch (error) {
    console.error('Error in anime recommendations:', error);
    throw error;
  }
}

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});