document.addEventListener('DOMContentLoaded', () => {
    const targetInput = document.getElementById('targetImage');
    const sourceInput = document.getElementById('sourceImages');
    const cellSizeInput = document.getElementById('cellSize');
    const blendOpacityInput = document.getElementById('blendOpacity');
    const renderScaleInput = document.getElementById('renderScale');
    const generateBtn = document.getElementById('generateBtn');
    const statusDiv = document.getElementById('status');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const resultCanvas = document.getElementById('resultCanvas');
    const ctx = resultCanvas.getContext('2d', { willReadFrequently: true });

    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    let activeTab = 'manual';

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.style.display = 'none');
            btn.classList.add('active');
            activeTab = btn.dataset.tab;
            document.getElementById(`${activeTab}-tab`).style.display = 'flex';
        });
    });

    generateBtn.addEventListener('click', async () => {
        const cellSize = parseInt(cellSizeInput.value);
        const blendIntensity = parseFloat(blendOpacityInput.value);
        const renderScale = parseInt(renderScaleInput.value); // HD множитель

        let targetImg;
        let sources = [];

        try {
            generateBtn.disabled = true;
            progressContainer.style.display = 'block';
            updateProgress(0);

            if (activeTab === 'manual') {
                if (!targetInput.files[0] || sourceInput.files.length === 0) {
                    alert('Выберите файлы.');
                    generateBtn.disabled = false; return;
                }
                statusDiv.textContent = 'Обработка ваших фото...';
                sources = await processSourceImages(sourceInput.files, cellSize * renderScale);
            } else {
                const targetKw = document.getElementById('targetKeyword').value.trim() || 'nature';
                const sourceKw = document.getElementById('sourceKeyword').value.trim() || 'cat';
                const count = Math.min(parseInt(document.getElementById('sourceCount').value) || 100, 300);

                statusDiv.textContent = `Загрузка ${count} уникальных фото...`;
                const urls = [];
                for (let i = 0; i < count; i++) {
                    const seed = Math.floor(Math.random() * 1000000);
                    const rawUrl = `https://loremflickr.com/300/300/${encodeURIComponent(sourceKw)}?lock=${seed}`;
                    urls.push(`https://images.weserv.nl/?url=${encodeURIComponent(rawUrl)}&n=-1`);
                }
                sources = await processSourceUrlsParallel(urls, cellSize * renderScale);
                
                statusDiv.textContent = `Загрузка основы...`;
                const targetRaw = `https://loremflickr.com/1200/900/${encodeURIComponent(targetKw)}?random=${Math.random()}`;
                targetImg = await loadImageRemote(`https://images.weserv.nl/?url=${encodeURIComponent(targetRaw)}&n=-1`, 20000);
            }

            if (activeTab === 'manual') targetImg = await loadImage(targetInput.files[0]);
            
            statusDiv.textContent = 'Подготовка холста высокого разрешения...';
            updateProgress(45);

            // Масштабируем холст для HD качества
            const finalWidth = targetImg.width * renderScale;
            const finalHeight = targetImg.height * renderScale;
            const finalCellSize = cellSize * renderScale;

            resultCanvas.width = finalWidth;
            resultCanvas.height = finalHeight;
            
            // Временный холст для анализа оригинала
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = targetImg.width;
            tempCanvas.height = targetImg.height;
            const tCtx = tempCanvas.getContext('2d');
            tCtx.drawImage(targetImg, 0, 0);
            const originalData = tCtx.getImageData(0, 0, targetImg.width, targetImg.height).data;

            ctx.clearRect(0, 0, finalWidth, finalHeight);

            const cols = Math.floor(targetImg.width / cellSize);
            const rows = Math.floor(targetImg.height / cellSize);
            const totalCells = cols * rows;
            let cellsDone = 0;

            // История последних использованных картинок для минимизации повторов рядом
            let lastUsedIndices = [];
            const historyLimit = Math.min(sources.length - 1, 15);

            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    const avgColor = getAverageColor(originalData, targetImg.width, x * cellSize, y * cellSize, cellSize);
                    
                    // Умный выбор: исключаем недавно использованные картинки
                    const bestMatch = findBestMatchUnique(avgColor, sources, lastUsedIndices, historyLimit);
                    
                    const posX = x * finalCellSize;
                    const posY = y * finalCellSize;

                    // 1. Отрисовка в HD
                    ctx.drawImage(bestMatch.canvas, posX, posY, finalCellSize, finalCellSize);

                    // 2. Цветокоррекция в HD
                    if (blendIntensity > 0) {
                        ctx.save();
                        ctx.globalCompositeOperation = 'color';
                        ctx.globalAlpha = blendIntensity;
                        ctx.fillStyle = `rgb(${avgColor.r}, ${avgColor.g}, ${avgColor.b})`;
                        ctx.fillRect(posX, posY, finalCellSize, finalCellSize);
                        ctx.restore();
                    }
                    
                    cellsDone++;
                    if (cellsDone % 100 === 0) {
                        updateProgress(45 + (cellsDone / totalCells) * 55);
                        statusDiv.textContent = `Сборка HD: ${Math.round((cellsDone / totalCells) * 100)}%`;
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
            }

            statusDiv.textContent = 'Готово! Нажмите "Сохранить как", чтобы получить HD файл.';
            updateProgress(100);
        } catch (error) {
            console.error(error);
            statusDiv.textContent = 'Ошибка: ' + error.message;
        } finally {
            generateBtn.disabled = false;
        }
    });

    async function processSourceUrlsParallel(urls, size) {
        const pool = [];
        let completed = 0;
        const batchSize = 6;
        for (let i = 0; i < urls.length; i += batchSize) {
            const batch = urls.slice(i, i + batchSize);
            const promises = batch.map(async (url, idx) => {
                try {
                    const img = await loadImageRemote(url, 15000);
                    // Добавляем только оригинал (убираем повороты по просьбе пользователя)
                    pool.push(createSourceItem(img, size, i + idx)); 
                    completed++;
                    statusDiv.textContent = `Загружено уникальных фото: ${completed}`;
                    updateProgress((completed / urls.length) * 45);
                } catch (e) { completed++; }
            });
            await Promise.all(promises);
            await new Promise(r => setTimeout(r, 50));
        }
        return pool;
    }

    async function processSourceImages(files, size) {
        const pool = [];
        for (let i = 0; i < files.length; i++) {
            try {
                const img = await loadImage(files[i]);
                pool.push(createSourceItem(img, size, i));
                updateProgress((i / files.length) * 45);
            } catch (e) { console.warn(e); }
        }
        return pool;
    }

    function createSourceItem(img, size, id) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const sCtx = canvas.getContext('2d');
        const minDim = Math.min(img.width, img.height);
        sCtx.drawImage(img, (img.width - minDim) / 2, (img.height - minDim) / 2, minDim, minDim, 0, 0, size, size);
        return { 
            id: id, 
            canvas: canvas, 
            avgColor: calculateAverageColor(sCtx.getImageData(0, 0, size, size).data) 
        };
    }

    function loadImage(file) {
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = e => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function loadImageRemote(url, timeoutMs = 20000) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            const timeout = setTimeout(() => { img.src = ""; reject(new Error("Timeout")); }, timeoutMs);
            img.onload = () => { clearTimeout(timeout); resolve(img); };
            img.onerror = () => { clearTimeout(timeout); reject(new Error("Load Error")); };
            img.src = url;
        });
    }

    function calculateAverageColor(data) {
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < data.length; i += 4) {
            r += data[i]; g += data[i + 1]; b += data[i + 2];
        }
        const count = data.length / 4 || 1;
        return { r: r / count, g: g / count, b: b / count };
    }

    function getAverageColor(data, width, startX, startY, size) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let y = startY; y < startY + size; y++) {
            for (let x = startX; x < startX + size; x++) {
                const idx = (y * width + x) * 4;
                if (idx < data.length) {
                    r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; count++;
                }
            }
        }
        return { r: r / (count || 1), g: g / (count || 1), b: b / (count || 1) };
    }

    // Умный выбор: исключаем недавно использованные и ищем Top-10
    function findBestMatchUnique(targetColor, pool, history, historyLimit) {
        const itemsWithDiff = pool
            .filter(p => !history.includes(p.id)) // Убираем недавние повторы
            .map(item => {
                const dr = targetColor.r - item.avgColor.r;
                const dg = targetColor.g - item.avgColor.g;
                const db = targetColor.b - item.avgColor.b;
                const diff = 0.3 * dr*dr + 0.59 * dg*dg + 0.11 * db*db;
                return { item, diff };
            });

        itemsWithDiff.sort((a, b) => a.diff - b.diff);
        
        // Берем случайную из Top-10 для живой картинки
        const best = itemsWithDiff[Math.floor(Math.random() * Math.min(10, itemsWithDiff.length))].item;
        
        // Обновляем историю
        history.push(best.id);
        if (history.length > historyLimit) history.shift();
        
        return best;
    }

    function updateProgress(percent) {
        progressBar.style.width = percent + '%';
    }
});
