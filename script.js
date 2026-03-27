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
        const blendOpacity = parseFloat(blendOpacityInput.value);

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
                targetImg = await loadImage(targetInput.files[0]);
            } else {
                const targetKw = document.getElementById('targetKeyword').value.trim() || 'nature';
                const sourceKw = document.getElementById('sourceKeyword').value.trim() || 'cat';
                const count = Math.min(parseInt(document.getElementById('sourceCount').value) || 50, 100);

                statusDiv.textContent = `Загрузка пула картинок ("${sourceKw}")...`;
                const urls = [];
                for (let i = 0; i < count; i++) {
                    const seed = Math.floor(Math.random() * 1000000);
                    const rawUrl = `https://loremflickr.com/150/150/${encodeURIComponent(sourceKw)}?lock=${seed}`;
                    urls.push(`https://images.weserv.nl/?url=${encodeURIComponent(rawUrl)}&n=-1`);
                }
                sources = await processSourceUrlsParallel(urls, cellSize);
                
                statusDiv.textContent = `Загрузка основы ("${targetKw}")...`;
                const targetRaw = `https://loremflickr.com/800/600/${encodeURIComponent(targetKw)}?random=${Math.random()}`;
                targetImg = await loadImageRemote(`https://images.weserv.nl/?url=${encodeURIComponent(targetRaw)}&n=-1`, 20000);
            }
            
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
                    const bestMatch = findBestMatchVaried(avgColor, sources, 5); // Выбираем из ТОП-5 случайную
                    
                    const posX = x * cellSize;
                    const posY = y * cellSize;

                    // 1. Отрисовка маленькой картинки
                    ctx.drawImage(bestMatch.canvas, posX, posY, cellSize, cellSize);

                    // 2. Наложение цвета оригинала (секрет узнаваемости)
                    if (blendOpacity > 0) {
                        ctx.fillStyle = `rgba(${avgColor.r}, ${avgColor.g}, ${avgColor.b}, ${blendOpacity})`;
                        ctx.fillRect(posX, posY, cellSize, cellSize);
                    }
                    
                    cellsDone++;
                    if (cellsDone % 100 === 0) {
                        updateProgress(50 + (cellsDone / totalCells) * 50);
                        statusDiv.textContent = `Сборка: ${Math.round((cellsDone / totalCells) * 100)}%`;
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
            }

            statusDiv.textContent = 'Готово! (ПКМ -> Сохранить как)';
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
                    pool.push(createSourceItem(img, size));
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
                pool.push(createSourceItem(img, size));
                updateProgress((i / files.length) * 50);
            } catch (e) { console.warn(e); }
        }
        return pool;
    }

    function createSourceItem(img, size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const sCtx = canvas.getContext('2d');
        const minDim = Math.min(img.width, img.height);
        sCtx.drawImage(img, (img.width - minDim) / 2, (img.height - minDim) / 2, minDim, minDim, 0, 0, size, size);
        return { canvas, avgColor: calculateAverageColor(sCtx.getImageData(0, 0, size, size).data) };
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

    // Улучшенный выбор: берем из ТОП-N лучших по цвету случайную картинку
    function findBestMatchVaried(targetColor, pool, topN = 5) {
        const itemsWithDiff = pool.map(item => {
            const diff = Math.pow(targetColor.r - item.avgColor.r, 2) +
                         Math.pow(targetColor.g - item.avgColor.g, 2) +
                         Math.pow(targetColor.b - item.avgColor.b, 2);
            return { item, diff };
        });

        // Сортируем по степени схожести
        itemsWithDiff.sort((a, b) => a.diff - b.diff);

        // Берем случайную из TopN
        const actualTopN = Math.min(topN, itemsWithDiff.length);
        const randomIndex = Math.floor(Math.random() * actualTopN);
        return itemsWithDiff[randomIndex].item;
    }

    function updateProgress(percent) {
        progressBar.style.width = percent + '%';
    }
});
