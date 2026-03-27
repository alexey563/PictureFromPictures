document.addEventListener('DOMContentLoaded', () => {
    const targetInput = document.getElementById('targetImage');
    const sourceInput = document.getElementById('sourceImages');
    const cellSizeInput = document.getElementById('cellSize');
    const generateBtn = document.getElementById('generateBtn');
    const statusDiv = document.getElementById('status');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const resultCanvas = document.getElementById('resultCanvas');
    const ctx = resultCanvas.getContext('2d', { willReadFrequently: true });

    let sourcePool = [];

    generateBtn.addEventListener('click', async () => {
        if (!targetInput.files[0] || sourceInput.files.length === 0) {
            alert('Пожалуйста, выберите основное изображение и хотя бы одно изображение для пула.');
            return;
        }

        const cellSize = parseInt(cellSizeInput.value);
        if (isNaN(cellSize) || cellSize < 5) {
            alert('Размер ячейки должен быть числом не меньше 5.');
            return;
        }

        try {
            generateBtn.disabled = true;
            statusDiv.textContent = 'Загрузка и обработка изображений пула...';
            progressContainer.style.display = 'block';
            updateProgress(0);

            // 1. Load and process source images
            sourcePool = await processSourceImages(sourceInput.files, cellSize);
            
            statusDiv.textContent = 'Обработка основного изображения...';
            updateProgress(30);

            // 2. Load and process target image
            const targetImg = await loadImage(targetInput.files[0]);
            resultCanvas.width = targetImg.width;
            resultCanvas.height = targetImg.height;
            ctx.drawImage(targetImg, 0, 0);

            const imageData = ctx.getImageData(0, 0, resultCanvas.width, resultCanvas.height);
            const { data, width, height } = imageData;

            // 3. Clear canvas for rendering
            ctx.clearRect(0, 0, width, height);

            // 4. Generate Mosaic
            const cols = Math.floor(width / cellSize);
            const rows = Math.floor(height / cellSize);
            const totalCells = cols * rows;
            let cellsDone = 0;

            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    const avgColor = getAverageColor(data, width, x * cellSize, y * cellSize, cellSize);
                    const bestMatch = findBestMatch(avgColor, sourcePool);
                    
                    ctx.drawImage(bestMatch.canvas, x * cellSize, y * cellSize, cellSize, cellSize);
                    
                    cellsDone++;
                    if (cellsDone % 50 === 0) {
                        const progress = 30 + (cellsDone / totalCells) * 70;
                        updateProgress(progress);
                        statusDiv.textContent = `Создание мозаики: ${Math.round((cellsDone / totalCells) * 100)}%`;
                        // Allow UI to update
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
            }

            statusDiv.textContent = 'Готово!';
            updateProgress(100);
        } catch (error) {
            console.error(error);
            statusDiv.textContent = 'Ошибка: ' + error.message;
        } finally {
            generateBtn.disabled = false;
        }
    });

    async function processSourceImages(files, size) {
        const pool = [];
        const total = files.length;
        
        for (let i = 0; i < total; i++) {
            try {
                const img = await loadImage(files[i]);
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const sCtx = canvas.getContext('2d');
                
                // Draw image cropped/resized to square
                const minDim = Math.min(img.width, img.height);
                const sx = (img.width - minDim) / 2;
                const sy = (img.height - minDim) / 2;
                sCtx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

                const data = sCtx.getImageData(0, 0, size, size).data;
                const avgColor = calculateAverageColor(data);

                pool.push({ canvas, avgColor });

                if (i % 5 === 0) {
                    const progress = (i / total) * 30;
                    updateProgress(progress);
                    statusDiv.textContent = `Обработка пула: ${Math.round((i / total) * 100)}%`;
                    await new Promise(r => setTimeout(r, 0));
                }
            } catch (e) {
                console.warn(`Не удалось загрузить изображение ${files[i].name}`, e);
            }
        }
        return pool;
    }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function calculateAverageColor(data) {
        let r = 0, g = 0, b = 0;
        const count = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
        }
        return {
            r: Math.round(r / count),
            g: Math.round(g / count),
            b: Math.round(b / count)
        };
    }

    function getAverageColor(data, width, startX, startY, size) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let y = startY; y < startY + size; y++) {
            for (let x = startX; x < startX + size; x++) {
                const idx = (y * width + x) * 4;
                if (idx < data.length) {
                    r += data[idx];
                    g += data[idx + 1];
                    b += data[idx + 2];
                    count++;
                }
            }
        }
        return {
            r: Math.round(r / count),
            g: Math.round(g / count),
            b: Math.round(b / count)
        };
    }

    function findBestMatch(targetColor, pool) {
        let bestMatch = pool[0];
        let minDiff = Infinity;

        for (const item of pool) {
            const diff = Math.sqrt(
                Math.pow(targetColor.r - item.avgColor.r, 2) +
                Math.pow(targetColor.g - item.avgColor.g, 2) +
                Math.pow(targetColor.b - item.avgColor.b, 2)
            );
            if (diff < minDiff) {
                minDiff = diff;
                bestMatch = item;
            }
        }
        return bestMatch;
    }

    function updateProgress(percent) {
        progressBar.style.width = percent + '%';
    }
});
