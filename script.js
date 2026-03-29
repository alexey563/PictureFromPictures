document.addEventListener('DOMContentLoaded', () => {
    const targetInput = document.getElementById('targetImage');
    const sourceInput = document.getElementById('sourceImages');
    const blendOpacityInput = document.getElementById('blendOpacity');
    const renderScaleInput = document.getElementById('renderScale');
    const keepOriginalInput = document.getElementById('keepOriginalColors');
    const blendControl = document.getElementById('blendControl');
    const generateBtn = document.getElementById('generateBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const downloadSvgBtn = document.getElementById('downloadSvgBtn');
    const downloadOptions = document.getElementById('downloadOptions');
    const statusDiv = document.getElementById('status');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const resultCanvas = document.getElementById('resultCanvas');
    const ctx = resultCanvas.getContext('2d', { willReadFrequently: true });

    // Admin Elements
    const adminPassword = document.getElementById('adminPassword');
    const adminSection = document.getElementById('adminSection');
    const fileUploadInput = document.getElementById('userFileUpload');
    const resultsList = document.getElementById('uploadedResultsList');
    
    // Modal Elements
    const modal = document.getElementById('fullscreenModal');
    const modalImg = document.getElementById('modalImg');
    const closeModal = document.querySelector('.close-modal');
    const zoomInBtn = document.getElementById('zoomIn');
    const zoomOutBtn = document.getElementById('zoomOut');
    const downloadOriginalBtn = document.getElementById('downloadOriginal');
    
    // --- Новая локальная БД (IndexedDB) для хранения 300MB+ файлов ---
    let db;
    const request = indexedDB.open("MosaicGallery", 1);
    request.onupgradeneeded = e => {
        db = e.target.result;
        db.createObjectStore("gallery", { keyPath: "id" });
    };
    request.onsuccess = e => { db = e.target.result; loadFromLocal(); };

    let uploadedResults = [];
    const ADMIN_PASSWORD = "admin";
    let currentZoom = 1;

    // Вход по паролю
    adminPassword.addEventListener('input', async () => {
        if (adminPassword.value === ADMIN_PASSWORD) {
            adminSection.style.display = 'block';
            adminPassword.blur();
            adminPassword.value = "";
            renderUploadedResults();
        } else {
            adminSection.style.display = 'none';
        }
    });

    // Загрузка файла в локальную БД (ОПТИМИЗИРОВАНО: храним Blob вместо DataURL)
    fileUploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !db) return;

        statusDiv.textContent = "Сохранение... Пожалуйста, подождите.";
        const id = Date.now();
        const thumbUrl = await createThumbnail(file, 300);
        
        // Сохраняем файл как чистый Blob (это максимально быстро и экономно)
        const item = { id, file: file, thumbUrl, fileName: file.name, rating: 0 };
        const tx = db.transaction("gallery", "readwrite");
        tx.objectStore("gallery").add(item);
        tx.oncomplete = () => {
            loadFromLocal();
            statusDiv.textContent = "Готово! Добавлено в локальную галерею.";
        };
    });

    async function loadFromLocal() {
        if (!db) return;
        const tx = db.transaction("gallery", "readonly");
        const store = tx.objectStore("gallery");
        const request = store.getAll();
        request.onsuccess = () => {
            uploadedResults = request.result;
            renderUploadedResults();
        };
    }

    function renderUploadedResults() {
        if (uploadedResults.length === 0) {
            resultsList.innerHTML = '<p class="empty-msg">В галерее пока пусто.</p>';
            return;
        }

        resultsList.innerHTML = "";
        uploadedResults.forEach(item => {
            const div = document.createElement('div');
            div.className = 'result-item';
            div.innerHTML = `
                <img src="${item.thumbUrl}" alt="Preview" onclick="viewOriginal(${item.id})">
                <div class="item-name" style="font-size: 0.7rem; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.fileName}</div>
                <div class="item-actions">
                    <span class="rate-btn" onclick="rateItem(${item.id})">★ ${item.rating}</span>
                    <button class="delete-btn" onclick="deleteItem(${item.id})">Удалить</button>
                </div>
            `;
            resultsList.appendChild(div);
        });
    }

    // --- Высокопроизводительный Canvas Viewer для 300MB+ фото ---
    const viewerCanvas = document.getElementById('viewerCanvas');
    const vCtx = viewerCanvas.getContext('2d', { alpha: false });
    const modalContainer = document.getElementById('modalContainer');
    
    let currentImageBitmap = null;
    let viewState = { x: 0, y: 0, scale: 1, isDragging: false, lastMouseX: 0, lastMouseY: 0 };

    window.viewOriginal = async (id) => {
        const item = uploadedResults.find(i => i.id === id);
        if (!item) return;

        statusDiv.textContent = "Декодирование Ultra HD... Пожалуйста, подождите.";
        modal.style.display = "block";
        
        // Показываем сначала превью, пока грузится оригинал
        const tempImg = new Image();
        tempImg.onload = () => {
            renderThumbToCanvas(tempImg);
        };
        tempImg.src = item.thumbUrl;

        try {
            // ФОНОВОЕ ДЕКОДИРОВАНИЕ: не вешает браузер
            if (currentImageBitmap) currentImageBitmap.close();
            currentImageBitmap = await createImageBitmap(item.file);
            
            // Сброс состояния просмотра
            const containerWidth = modalContainer.clientWidth;
            const containerHeight = modalContainer.clientHeight;
            const scaleX = containerWidth / currentImageBitmap.width;
            const scaleY = containerHeight / currentImageBitmap.height;
            viewState.scale = Math.min(scaleX, scaleY, 1);
            viewState.x = (containerWidth - currentImageBitmap.width * viewState.scale) / 2;
            viewState.y = (containerHeight - currentImageBitmap.height * viewState.scale) / 2;
            
            draw();
            statusDiv.textContent = "Готово! Используйте колесико для зума и мышь для перемещения.";
        } catch (e) {
            console.error(e);
            alert("Браузеру не хватило памяти для декодирования оригинала. Попробуйте файл меньшего размера.");
        }
    };

    function renderThumbToCanvas(img) {
        viewerCanvas.width = modalContainer.clientWidth;
        viewerCanvas.height = modalContainer.clientHeight;
        vCtx.fillStyle = "#000";
        vCtx.fillRect(0, 0, viewerCanvas.width, viewerCanvas.height);
        const scale = Math.min(viewerCanvas.width / img.width, viewerCanvas.height / img.height);
        const x = (viewerCanvas.width - img.width * scale) / 2;
        const y = (viewerCanvas.height - img.height * scale) / 2;
        vCtx.drawImage(img, x, y, img.width * scale, img.height * scale);
    }

    function draw() {
        if (!currentImageBitmap) return;
        
        viewerCanvas.width = modalContainer.clientWidth;
        viewerCanvas.height = modalContainer.clientHeight;
        
        vCtx.fillStyle = "#111";
        vCtx.fillRect(0, 0, viewerCanvas.width, viewerCanvas.height);
        
        // Отрисовка только видимой части
        vCtx.imageSmoothingEnabled = viewState.scale < 1;
        vCtx.drawImage(
            currentImageBitmap, 
            viewState.x, viewState.y, 
            currentImageBitmap.width * viewState.scale, 
            currentImageBitmap.height * viewState.scale
        );
    }

    // Обработка перемещения (Pan)
    modalContainer.onmousedown = (e) => {
        viewState.isDragging = true;
        viewState.lastMouseX = e.clientX;
        viewState.lastMouseY = e.clientY;
        modalContainer.style.cursor = "grabbing";
    };

    window.onmousemove = (e) => {
        if (!viewState.isDragging) return;
        const dx = e.clientX - viewState.lastMouseX;
        const dy = e.clientY - viewState.lastMouseY;
        viewState.x += dx;
        viewState.y += dy;
        viewState.lastMouseX = e.clientX;
        viewState.lastMouseY = e.clientY;
        draw();
    };

    window.onmouseup = () => {
        viewState.isDragging = false;
        modalContainer.style.cursor = "grab";
    };

    // Плавный зум (Zoom)
    modalContainer.onwheel = (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? 0.8 : 1.2;
        
        // Центрируем зум относительно курсора
        const mouseX = e.clientX - modalContainer.getBoundingClientRect().left;
        const mouseY = e.clientY - modalContainer.getBoundingClientRect().top;
        
        const imgX = (mouseX - viewState.x) / viewState.scale;
        const imgY = (mouseY - viewState.y) / viewState.scale;
        
        viewState.scale *= zoomFactor;
        
        // Ограничения
        if (viewState.scale < 0.05) viewState.scale = 0.05;
        if (viewState.scale > 50) viewState.scale = 50;
        
        viewState.x = mouseX - imgX * viewState.scale;
        viewState.y = mouseY - imgY * viewState.scale;
        
        draw();
    };

    // Кнопки зума
    zoomInBtn.onclick = () => {
        const centerX = viewerCanvas.width / 2;
        const centerY = viewerCanvas.height / 2;
        const imgX = (centerX - viewState.x) / viewState.scale;
        const imgY = (centerY - viewState.y) / viewState.scale;
        viewState.scale *= 1.5;
        viewState.x = centerX - imgX * viewState.scale;
        viewState.y = centerY - imgY * viewState.scale;
        draw();
    };

    zoomOutBtn.onclick = () => {
        const centerX = viewerCanvas.width / 2;
        const centerY = viewerCanvas.height / 2;
        const imgX = (centerX - viewState.x) / viewState.scale;
        const imgY = (centerY - viewState.y) / viewState.scale;
        viewState.scale *= 0.7;
        viewState.x = centerX - imgX * viewState.scale;
        viewState.y = centerY - imgY * viewState.scale;
        draw();
    };

    closeModal.onclick = () => {
        modal.style.display = "none";
        if (currentImageBitmap) {
            currentImageBitmap.close();
            currentImageBitmap = null;
        }
    };

    downloadOriginalBtn.onclick = () => {
        // Чтобы скачать, берем данные из текущей выбранной мозаики
        const item = uploadedResults.find(i => {
             // Ищем текущую открытую картинку по имени файла или ID
             return i.fileName === statusDiv.textContent.replace("Готово! ", ""); 
        }) || uploadedResults[0]; 

        if (item) {
            const url = URL.createObjectURL(item.file);
            const link = document.createElement('a');
            link.href = url;
            link.download = item.fileName;
            link.click();
            URL.revokeObjectURL(url);
        }
    };

    async function createThumbnail(file, size) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = size / Math.max(img.width, img.height);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.src = URL.createObjectURL(file);
        });
    }

    // Modal Logic (zoom, fullscreen)
    window.openFullscreen = (src) => {
        modalImg.src = src;
        modal.style.display = "block";
        currentZoom = 1;
        updateZoom();
    };
    
    closeModal.onclick = () => modal.style.display = "none";
    window.onclick = (event) => { if (event.target == modal) modal.style.display = "none"; };
    function updateZoom() { modalImg.style.transform = `scale(${currentZoom})`; }
    zoomInBtn.onclick = () => { currentZoom += 0.5; updateZoom(); };
    zoomOutBtn.onclick = () => { if (currentZoom > 0.5) currentZoom -= 0.5; updateZoom(); };

    modalImg.onwheel = (e) => {
        e.preventDefault();
        if (e.deltaY < 0) currentZoom += 0.2;
        else if (currentZoom > 0.2) currentZoom -= 0.2;
        updateZoom();
    };

    downloadOriginalBtn.onclick = () => {
        const link = document.createElement('a');
        link.href = modalImg.src;
        link.download = "mosaic_result_" + Date.now();
        link.click();
    };

    // Actions
    window.rateItem = (id) => {
        const item = uploadedResults.find(i => i.id === id);
        if (item) {
            item.rating++;
            const tx = db.transaction("gallery", "readwrite");
            tx.objectStore("gallery").put(item);
            tx.oncomplete = () => loadFromLocal();
        }
    };

    window.deleteItem = (id) => {
        if (confirm("Удалить это из вашей локальной галереи?")) {
            const tx = db.transaction("gallery", "readwrite");
            tx.objectStore("gallery").delete(id);
            tx.oncomplete = () => loadFromLocal();
        }
    };

    let mosaicData = { cols: 0, rows: 0, cellSize: 0, grid: [], sources: [] };

    // Очистка при загрузке (чтобы не оставалось старых данных)
    function resetApp() {
        targetInput.value = "";
        sourceInput.value = "";
        document.getElementById('targetKeyword').value = "";
        document.getElementById('sourceKeyword').value = "";
        document.getElementById('sourceCount').value = 100;
        renderScaleInput.value = 4;
        keepOriginalInput.checked = true;
        blendOpacityInput.value = 0.3;
        blendControl.style.display = 'none';
        
        statusDiv.textContent = 'Готов к работе.';
        progressContainer.style.display = 'none';
        progressBar.style.width = '0%';
        downloadOptions.style.display = 'none';
        
        ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
        resultCanvas.width = 0;
        resultCanvas.height = 0;
    }

    resetApp();

    keepOriginalInput.addEventListener('change', () => {
        blendControl.style.display = keepOriginalInput.checked ? 'none' : 'block';
    });

    generateBtn.addEventListener('click', async () => {
        const renderScale = parseInt(renderScaleInput.value);
        const keepOriginal = keepOriginalInput.checked;
        const blendIntensity = keepOriginal ? 0 : parseFloat(blendOpacityInput.value);

        let targetImgRaw;
        let sources = [];

        try {
            generateBtn.disabled = true;
            downloadOptions.style.display = 'none';
            progressContainer.style.display = 'block';
            updateProgress(0);

            if (activeTab === 'manual') {
                if (!targetInput.files[0] || sourceInput.files.length === 0) {
                    alert('Выберите файлы.');
                    generateBtn.disabled = false; return;
                }
                statusDiv.textContent = 'Обработка пула...';
                sources = await processSourceImages(sourceInput.files, 150); 
                targetImgRaw = await loadImage(targetInput.files[0]);
            } else {
                const targetKw = document.getElementById('targetKeyword').value.trim() || 'nature';
                const sourceKw = document.getElementById('sourceKeyword').value.trim() || 'cat';
                const count = Math.min(parseInt(document.getElementById('sourceCount').value) || 100, 300);

                statusDiv.textContent = `Загрузка ${count} фото...`;
                const urls = [];
                for (let i = 0; i < count; i++) {
                    const seed = Math.floor(Math.random() * 1000000);
                    const rawUrl = `https://loremflickr.com/400/400/${encodeURIComponent(sourceKw)}?lock=${seed}`;
                    urls.push(`https://images.weserv.nl/?url=${encodeURIComponent(rawUrl)}&n=-1`);
                }
                sources = await processSourceUrlsParallel(urls, 150);
                
                statusDiv.textContent = `Загрузка основы...`;
                const targetUrl = `https://loremflickr.com/1600/1200/${encodeURIComponent(targetKw)}?random=${Math.random()}`;
                targetImgRaw = await loadImageRemote(`https://images.weserv.nl/?url=${encodeURIComponent(targetUrl)}&n=-1`, 20000);
            }

            const targetWidth = targetImgRaw.width;
            const targetHeight = targetImgRaw.height;
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = targetWidth; tempCanvas.height = targetHeight;
            const tCtx = tempCanvas.getContext('2d');
            tCtx.drawImage(targetImgRaw, 0, 0);
            const targetDataRaw = tCtx.getImageData(0, 0, targetWidth, targetHeight).data;

            const cols = Math.max(40, Math.min(120, Math.round(Math.sqrt(sources.length) * 7)));
            const baseCellSize = Math.floor(targetWidth / cols);
            const finalCellSize = baseCellSize * renderScale;

            statusDiv.textContent = `Сетка: ${cols} колонок. Подготовка Ultra HD...`;
            updateProgress(45);

            resultCanvas.width = targetWidth * renderScale;
            resultCanvas.height = targetHeight * renderScale;
            ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);

            const rows = Math.floor(targetHeight / baseCellSize);
            const totalCells = cols * rows;
            let cellsDone = 0;
            let lastUsedIds = [];
            
            // Сохраняем данные для SVG экспорта
            mosaicData = { 
                cols, rows, 
                cellSize: baseCellSize, 
                finalCellSize,
                grid: [], 
                sources,
                renderScale,
                width: targetWidth,
                height: targetHeight,
                keepOriginal,
                blendIntensity
            };

            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    const avgColor = getAverageColor(targetDataRaw, targetWidth, x * baseCellSize, y * baseCellSize, baseCellSize);
                    const bestMatch = findBestMatchUnique(avgColor, sources, lastUsedIds, 15);
                    
                    const posX = x * finalCellSize;
                    const posY = y * finalCellSize;

                    // Отрисовка PNG
                    ctx.drawImage(bestMatch.canvas, posX, posY, finalCellSize, finalCellSize);
                    if (!keepOriginal && blendIntensity > 0) {
                        ctx.save();
                        ctx.globalCompositeOperation = 'color';
                        ctx.globalAlpha = blendIntensity;
                        ctx.fillStyle = `rgb(${avgColor.r}, ${avgColor.g}, ${avgColor.b})`;
                        ctx.fillRect(posX, posY, finalCellSize, finalCellSize);
                        ctx.restore();
                    }

                    // Сохраняем в сетку для экспорта
                    mosaicData.grid.push({ x, y, sourceId: bestMatch.id, color: avgColor });
                    
                    cellsDone++;
                    if (cellsDone % 100 === 0) {
                        updateProgress(45 + (cellsDone / totalCells) * 55);
                        statusDiv.textContent = `Сборка Ultra HD: ${Math.round((cellsDone / totalCells) * 100)}%`;
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
            }

            statusDiv.textContent = 'Готово! Выберите формат для скачивания.';
            updateProgress(100);
            downloadOptions.style.display = 'flex';
        } catch (error) {
            console.error(error);
            statusDiv.textContent = 'Ошибка: ' + error.message;
        } finally {
            generateBtn.disabled = false;
        }
    });

    // Экспорт в SVG (Векторная сетка)
    downloadSvgBtn.addEventListener('click', () => {
        statusDiv.textContent = 'Подготовка векторного файла...';
        
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${mosaicData.width} ${mosaicData.height}" width="${mosaicData.width * 5}" height="${mosaicData.height * 5}">`;
        
        // 1. Секция Defs: Каждая уникальная картинка записывается только ОДИН раз
        svg += '<defs>';
        mosaicData.sources.forEach(s => {
            const dataUrl = s.canvas.toDataURL('image/jpeg', 0.85);
            svg += `<image id="img-${s.id}" width="${mosaicData.cellSize}" height="${mosaicData.cellSize}" xlink:href="${dataUrl}" />`;
        });
        svg += '</defs>';

        // 2. Секция Use: Просто расставляем ссылки на картинки по сетке
        mosaicData.grid.forEach(cell => {
            const x = cell.x * mosaicData.cellSize;
            const y = cell.y * mosaicData.cellSize;
            svg += `<use xlink:href="#img-${cell.sourceId}" x="${x}" y="${y}" />`;
            
            // Если включена цветокоррекция, добавляем полупрозрачные прямоугольники
            if (!mosaicData.keepOriginal && mosaicData.blendIntensity > 0) {
                const color = `rgb(${cell.color.r},${cell.color.g},${cell.color.b})`;
                svg += `<rect x="${x}" y="${y}" width="${mosaicData.cellSize}" height="${mosaicData.cellSize}" fill="${color}" fill-opacity="${mosaicData.blendIntensity}" />`;
            }
        });

        svg += '</svg>';
        
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `mosaic_vector_${Date.now()}.svg`;
        link.href = url;
        link.click();
        statusDiv.textContent = 'Векторный файл скачан!';
    });

    downloadBtn.addEventListener('click', () => {
        statusDiv.textContent = 'Подготовка файла PNG (это может занять время)...';
        downloadBtn.disabled = true;

        resultCanvas.toBlob((blob) => {
            if (!blob) {
                statusDiv.textContent = 'Ошибка: не удалось создать файл. Попробуйте уменьшить качество.';
                downloadBtn.disabled = false;
                return;
            }
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = `mosaic_print_${Date.now()}.png`;
            link.href = url;
            link.click();
            
            // Даем время на запуск скачивания перед очисткой памяти
            setTimeout(() => {
                URL.revokeObjectURL(url);
                statusDiv.textContent = 'Файл PNG успешно скачан!';
                downloadBtn.disabled = false;
            }, 1000);
        }, 'image/png');
    });

    // --- Существующие функции (без изменений) ---
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

    async function processSourceUrlsParallel(urls, size) {
        const pool = [];
        let completed = 0;
        const batchSize = 6;
        for (let i = 0; i < urls.length; i += batchSize) {
            const batch = urls.slice(i, i + batchSize);
            const promises = batch.map(async (url, idx) => {
                try {
                    const img = await loadImageRemote(url, 15000);
                    pool.push(createSourceItem(img, size, i + idx));
                    completed++;
                    statusDiv.textContent = `Загружено: ${completed} из ${urls.length}`;
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
        canvas.width = size; canvas.height = size;
        const sCtx = canvas.getContext('2d');
        const minDim = Math.min(img.width, img.height);
        sCtx.drawImage(img, (img.width - minDim) / 2, (img.height - minDim) / 2, minDim, minDim, 0, 0, size, size);
        return { id: id, canvas: canvas, avgColor: calculateAverageColor(sCtx.getImageData(0, 0, size, size).data) };
    }

    function loadImage(file) {
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = e => { const img = new Image(); img.onload = () => resolve(img); img.src = e.target.result; };
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
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
        const count = data.length / 4 || 1;
        return { r: r / count, g: g / count, b: b / count };
    }

    function getAverageColor(data, width, startX, startY, size) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let y = startY; y < startY + size; y++) {
            for (let x = startX; x < startX + size; x++) {
                const idx = (y * width + x) * 4;
                if (idx < data.length) { r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; count++; }
            }
        }
        return { r: r / (count || 1), g: g / (count || 1), b: b / (count || 1) };
    }

    function findBestMatchUnique(targetColor, pool, history, historyLimit) {
        const itemsWithDiff = pool
            .filter(p => !history.includes(p.id))
            .map(item => {
                const dr = targetColor.r - item.avgColor.r;
                const dg = targetColor.g - item.avgColor.g;
                const db = targetColor.b - item.avgColor.b;
                const diff = 0.3 * dr*dr + 0.59 * dg*dg + 0.11 * db*db;
                return { item, diff };
            });
        itemsWithDiff.sort((a, b) => a.diff - b.diff);
        const best = itemsWithDiff[Math.floor(Math.random() * Math.min(5, itemsWithDiff.length))].item;
        history.push(best.id);
        if (history.length > historyLimit) history.shift();
        return best;
    }

    function updateProgress(percent) { progressBar.style.width = percent + '%'; }
});
