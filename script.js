document.addEventListener('DOMContentLoaded', () => {
    const targetInput = document.getElementById('targetImage');
    const sourceInput = document.getElementById('sourceImages');
    const cellSizeInput = document.getElementById('cellSize');
    const blendOpacityInput = document.getElementById('blendOpacity');
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
        const blendIntensity = parseFloat(blendOpacityInput.value); // Интенсивность коррекции

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
                sources = await processSourceImages(sourceInput.files, cellSize);
            } else {
                const targetKw = document.getElementById('targetKeyword').value.trim() || 'nature';
                const sourceKw = document.getElementById('sourceKeyword').value.trim() || 'cat';
                const count = Math.min(parseInt(document.getElementById('sourceCount').value) || 50, 100);

                statusDiv.textContent = `Загрузка пула картинок...`;
                const urls = [];
                for (let i = 0; i < count; i++) {
                    const seed = Math.floor(Math.random() * 1000000);
                    const rawUrl = `https://loremflickr.com/150/150/${encodeURIComponent(sourceKw)}?lock=${seed}`;
                    urls.push(`https://images.weserv.nl/?url=${encodeURIComponent(rawUrl)}&n=-1`);
                }
                sources = await processSourceUrlsParallel(urls, cellSize);
                
                statusDiv.textContent = `Загрузка основы...`;
                const targetRaw = `https://loremflickr.com/800/600/${encodeURIComponent(targetKw)}?random=${Math.random()}`;
                targetImg = await loadImageRemote(`https://images.weserv.nl/?url=${encodeURIComponent(targetRaw)}&n=-1`, 20000);
            }

            if (activeTab === 'manual') targetImg = await loadImage(targetInput.files[0]);
            
            statusDiv.textContent = 'Сборка мозаики...';
            updateProgress(50);

            resultCanvas.width = targetImg.width;
            resultCanvas.height = targetImg.height;
            ctx.drawImage(targetImg, 0, 0);

            const imageData = ctx.getImageData(0, 0, resultCanvas.width, resultCanvas.height);
            const { data, width, height } = imageData;
            ctx.clearRect(0, 0, width, height);

            const cols = Math.floor(width / cellSize);
            const rows = Math.floor(height / cellSize);
            const totalCells = cols * rows;
            let cellsDone = 0;

            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    const avgColor = getAverageColor(data, width, x * cellSize, y * cellSize, cellSize);
                    // Выбираем из ТОП-3, чтобы было разнообразие, но без потери качества
                    const bestMatch = findBestMatchVaried(avgColor, sources, 3); 
                    
                    const posX = x * cellSize;
                    const posY = y * cellSize;

                    // 1. Отрисовка оригинальной маленькой картинки
                    ctx.drawImage(bestMatch.canvas, posX, posY, cellSize, cellSize);

                    // 2. Умная цветокоррекция (подстраивание под место)
                    if (blendIntensity > 0) {
                        ctx.save();
                        // Используем режим 'color', который меняет цвет, но сохраняет детали
                        ctx.globalCompositeOperation = 'color';
                        ctx.globalAlpha = blendIntensity;
                        ctx.fillStyle = `rgb(${avgColor.r}, ${avgColor.g}, ${avgColor.b})`;
                        ctx.fillRect(posX, posY, cellSize, cellSize);
                        ctx.restore();
                    }
                    
                    cellsDone++;
                    if (cellsDone % 100 === 0) {
                        updateProgress(50 + (cellsDone / totalCells) * 50);
                        statusDiv.textContent = `Сборка: ${Math.round((cellsDone / totalCells) * 100)}%`;
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
            }

            statusDiv.textContent = 'Готово! Картинка теперь похожа на оригинал.';
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
        const batchSize = 5;
        for (let i = 0; i < urls.length; i += batchSize) {
            const batch = urls.slice(i, i + batchSize);
            const promises = batch.map(async (url) => {
                try {
                    const img = await loadImageRemote(url, 10000);
                    // Добавляем саму картинку и её зеркальные копии для разнообразия
                    addSourceItemsToPool(pool, img, size);
                    completed++;
                    statusDiv.textContent = `Загружено: ${completed} из ${urls.length}`;
                    updateProgress((completed / urls.length) * 50);
                } catch (e) { completed++; }
            });
            await Promise.all(promises);
            await new Promise(r => setTimeout(r, 100));
        }
        return pool;
    }

    async function processSourceImages(files, size) {
        const pool = [];
        for (let i = 0; i < files.length; i++) {
            try {
                const img = await loadImage(files[i]);
                addSourceItemsToPool(pool, img, size);
                updateProgress((i / files.length) * 50);
            } catch (e) { console.warn(e); }
        }
        return pool;
    }

    // Создает 3 варианта каждой картинки (оригинал + отражения)
    function addSourceItemsToPool(pool, img, size) {
        // 1. Оригинал
        pool.push(createSourceItem(img, size, 'normal'));
        // 2. Отражение по горизонтали
        pool.push(createSourceItem(img, size, 'flipH'));
        // 3. Отражение по вертикали
        pool.push(createSourceItem(img, size, 'flipV'));
    }

    function createSourceItem(img, size, transform) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const sCtx = canvas.getContext('2d');
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        if (transform === 'flipH') {
            sCtx.translate(size, 0);
            sCtx.scale(-1, 1);
        } else if (transform === 'flipV') {
            sCtx.translate(0, size);
            sCtx.scale(1, -1);
        }

        sCtx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        const data = sCtx.getImageData(0, 0, size, size).data;
        return { canvas, avgColor: calculateAverageColor(data) };
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

    function loadImageRemote(url, timeoutMs = 15000) {
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

    function findBestMatchVaried(targetColor, pool, topN = 3) {
        const itemsWithDiff = pool.map(item => {
            // Взвешенное RGB расстояние (лучше для человеческого глаза)
            const dr = targetColor.r - item.avgColor.r;
            const dg = targetColor.g - item.avgColor.g;
            const db = targetColor.b - item.avgColor.b;
            const diff = 0.3 * dr*dr + 0.59 * dg*dg + 0.11 * db*db;
            return { item, diff };
        });

        itemsWithDiff.sort((a, b) => a.diff - b.diff);
        const actualTopN = Math.min(topN, itemsWithDiff.length);
        const randomIndex = Math.floor(Math.random() * actualTopN);
        return itemsWithDiff[randomIndex].item;
    }

    function updateProgress(percent) {
        progressBar.style.width = percent + '%';
    }
});
