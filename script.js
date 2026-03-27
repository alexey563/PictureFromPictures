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
        if (isNaN(cellSize) || cellSize < 5) {
            alert('Размер ячейки должен быть не меньше 5.');
            return;
        }

        let targetImg;
        let sources = [];

        try {
            generateBtn.disabled = true;
            progressContainer.style.display = 'block';
            updateProgress(0);

            if (activeTab === 'manual') {
                if (!targetInput.files[0] || sourceInput.files.length === 0) {
                    alert('Выберите файлы.');
                    generateBtn.disabled = false;
                    return;
                }
                statusDiv.textContent = 'Обработка ваших фото...';
                sources = await processSourceImages(sourceInput.files, cellSize);
                targetImg = await loadImage(targetInput.files[0]);
            } else {
                const targetKw = document.getElementById('targetKeyword').value.trim() || 'nature';
                const sourceKw = document.getElementById('sourceKeyword').value.trim() || 'cat';
                const count = parseInt(document.getElementById('sourceCount').value) || 20;

                statusDiv.textContent = `Загрузка пула картинок ("${sourceKw}")...`;
                
                // Используем Unsplash Source - он быстрее и стабильнее
                const urls = [];
                for (let i = 0; i < count; i++) {
                    const randomSig = Math.floor(Math.random() * 100000);
                    // Проксируем через weserv.nl для обхода CORS и ускорения
                    const rawUrl = `source.unsplash.com/featured/150x150/?${encodeURIComponent(sourceKw)}&sig=${randomSig}`;
                    urls.push(`https://images.weserv.nl/?url=${rawUrl}&default=identicon`);
                }
                
                sources = await processSourceUrlsParallel(urls, cellSize);
                
                if (sources.length === 0) {
                    throw new Error("Не удалось загрузить картинки. Проверьте интернет или попробуйте другое слово (на англ.)");
                }

                statusDiv.textContent = `Загрузка основы ("${targetKw}")...`;
                const targetRaw = `source.unsplash.com/featured/800x600/?${encodeURIComponent(targetKw)}&sig=${Math.random()}`;
                targetImg = await loadImageRemote(`https://images.weserv.nl/?url=${targetRaw}`, 15000);
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
                    const bestMatch = findBestMatch(avgColor, sources);
                    ctx.drawImage(bestMatch.canvas, x * cellSize, y * cellSize, cellSize, cellSize);
                    
                    cellsDone++;
                    if (cellsDone % 100 === 0) {
                        updateProgress(50 + (cellsDone / totalCells) * 50);
                        statusDiv.textContent = `Сборка: ${Math.round((cellsDone / totalCells) * 100)}%`;
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
            }

            statusDiv.textContent = 'Готово! Картинку можно сохранить (ПКМ -> Сохранить как).';
            updateProgress(100);
        } catch (error) {
            console.error(error);
            statusDiv.textContent = 'Ошибка: ' + error.message;
        } finally {
            generateBtn.disabled = false;
        }
    });

    // Максимально быстрая параллельная загрузка
    async function processSourceUrlsParallel(urls, size) {
        const pool = [];
        let completed = 0;
        
        // Запускаем ВСЕ запросы сразу
        const promises = urls.map(async (url) => {
            try {
                const img = await loadImageRemote(url, 8000); // 8 секунд на картинку
                pool.push(createSourceItem(img, size));
                completed++;
                statusDiv.textContent = `Загрузка: ${completed} из ${urls.length} успешно`;
                updateProgress((completed / urls.length) * 50);
            } catch (e) {
                console.warn("Пропуск картинки:", e.message);
                completed++; // Считаем завершенным, даже если ошибка
            }
        });

        await Promise.all(promises);
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

    function loadImageRemote(url, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            const timeout = setTimeout(() => {
                img.src = ""; 
                reject(new Error("Timeout"));
            }, timeoutMs);
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

    function findBestMatch(targetColor, pool) {
        let best = pool[0], minDiff = Infinity;
        for (const item of pool) {
            const diff = Math.pow(targetColor.r - item.avgColor.r, 2) +
                         Math.pow(targetColor.g - item.avgColor.g, 2) +
                         Math.pow(targetColor.b - item.avgColor.b, 2);
            if (diff < minDiff) { minDiff = diff; best = item; }
        }
        return best;
    }

    function updateProgress(percent) {
        progressBar.style.width = percent + '%';
    }
});
