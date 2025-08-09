document.addEventListener('DOMContentLoaded', function() {
    const recommendationForm = document.getElementById('recommendationForm');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const resultsContainer = document.getElementById('resultsContainer');
    const recommendationsList = document.getElementById('recommendationsList');
    
    recommendationForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Get form values
        const titles = document.getElementById('titlesInput').value.trim();
        const preferences = document.getElementById('preferencesInput').value.trim();
        const genres = document.getElementById('genresInput').value.trim();
        const exclude = document.getElementById('excludeInput').value.trim();
        
        if (!titles) {
            alert('Please enter at least one manga or manhwa title');
            return;
        }
        
        // Show loading, hide results
        loadingIndicator.style.display = 'block';
        resultsContainer.style.display = 'none';
        recommendationsList.innerHTML = '';
        
        try {
            // Call the API
            const response = await fetch('/api/recommend', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    titles: titles.split(',').map(title => title.trim()),
                    preferences,
                    genres,
                    exclude
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to get recommendations');
            }
            
            const data = await response.json();
            
            // Display recommendations
            if (data.recommendations && data.recommendations.length > 0) {
                data.recommendations.forEach(manga => {
                    const card = createMangaCard(manga);
                    recommendationsList.appendChild(card);
                });
                
                resultsContainer.style.display = 'block';
                // Scroll to results
                resultsContainer.scrollIntoView({ behavior: 'smooth' });
            } else {
                throw new Error('No recommendations found');
            }
            
        } catch (error) {
            console.error('Error:', error);
            alert('Error: ' + error.message);
        } finally {
            loadingIndicator.style.display = 'none';
        }
    });
    
    function createMangaCard(manga) {
        const card = document.createElement('div');
        card.className = 'manga-card';
        
        // Random background color for variety
        const colors = ['#333', '#2C3E50', '#1A237E', '#1B5E20', '#3E2723', '#263238'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        
        let genreTags = '';
        if (manga.genres && manga.genres.length > 0) {
            genreTags = manga.genres.map(genre => 
                `<span class="genre-tag">${genre}</span>`
            ).join('');
        }
        
        card.innerHTML = `
            <div class="card-header" style="background-color: ${randomColor}">
                <span class="manga-type">${manga.type || 'Manga'}</span>
                <h3 class="manga-title">${manga.title}</h3>
                <div class="manga-creator">by ${manga.creator}</div>
            </div>
            <div class="card-body">
                <div class="manga-genres">
                    ${genreTags}
                </div>
                <div class="manga-description">${manga.description}</div>
                <div class="similar-to"><strong>Similar to:</strong> ${manga.similarTo}</div>
                <div class="recommendation-reason"><strong>Why:</strong> ${manga.whyRecommended}</div>
            </div>
        `;
        
        return card;
    }
    
    // Add animation effects
    const formContainer = document.querySelector('.form-container');
    formContainer.classList.add('fade-in');
    
    // Form validation styling
    const formInputs = document.querySelectorAll('input, textarea');
    formInputs.forEach(input => {
        input.addEventListener('blur', function() {
            if (this.value.trim() !== '') {
                this.classList.add('valid');
            } else {
                this.classList.remove('valid');
            }
        });
    });
});