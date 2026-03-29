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
    const viewerCanvas = document.getElementById('viewerCanvas');
    const vCtx = viewerCanvas.getContext('2d', { alpha: false });
    const modalContainer = document.getElementById('modalContainer');
    const closeModal = document.querySelector('.close-modal');
    const zoomInBtn = document.getElementById('zoomIn');
    const zoomOutBtn = document.getElementById('zoomOut');
    const downloadOriginalBtn = document.getElementById('downloadOriginal');
    
    // --- Локальная БД (IndexedDB) ---
    let db;
    const request = indexedDB.open("MosaicGallery", 1);
    request.onupgradeneeded = e => {
        db = e.target.result;
        db.createObjectStore("gallery", { keyPath: "id" });
    };
    request.onsuccess = e => { db = e.target.result; loadFromLocal(); };

    let uploadedResults = [];
    const ADMIN_PASSWORD = "admin";
    let currentImageBitmap = null;
    let viewState = { x: 0, y: 0, scale: 1, isDragging: false, lastMouseX: 0, lastMouseY: 0, currentId: null };

    // Вход по паролю
    adminPassword.addEventListener('input', () => {
        if (adminPassword.value === ADMIN_PASSWORD) {
            adminSection.style.display = 'block';
            adminPassword.blur();
            adminPassword.value = "";
            renderUploadedResults();
        } else {
            adminSection.style.display = 'none';
        }
    });

    // Загрузка файла
    fileUploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !db) return;

        statusDiv.textContent = "Сохранение... Пожалуйста, подождите.";
        const id = Date.now();
        const thumbUrl = await createThumbnail(file, 300);
        
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

    // --- Высокопроизводительный Viewer ---
    window.viewOriginal = async (id) => {
        const item = uploadedResults.find(i => i.id === id);
        if (!item) return;

        viewState.currentId = id;
        statusDiv.textContent = "Декодирование... Пожалуйста, подождите.";
        modal.style.display = "block";
        
        // Показываем превью на холсте
        const tempImg = new Image();
        tempImg.onload = () => {
            viewerCanvas.width = modalContainer.clientWidth;
            viewerCanvas.height = modalContainer.clientHeight;
            const scale = Math.min(viewerCanvas.width / tempImg.width, viewerCanvas.height / tempImg.height);
            vCtx.fillStyle = "#000";
            vCtx.fillRect(0, 0, viewerCanvas.width, viewerCanvas.height);
            vCtx.drawImage(tempImg, (viewerCanvas.width - tempImg.width * scale)/2, (viewerCanvas.height - tempImg.height * scale)/2, tempImg.width * scale, tempImg.height * scale);
        };
        tempImg.src = item.thumbUrl;

        try {
            if (currentImageBitmap) currentImageBitmap.close();
            
            // Проверка: если в базе строка (Base64), конвертим в Blob
            let fileSource = item.file;
            if (typeof fileSource === "string") {
                const res = await fetch(fileSource);
                fileSource = await res.blob();
            }

            currentImageBitmap = await createImageBitmap(fileSource);
            
            const containerWidth = modalContainer.clientWidth;
            const containerHeight = modalContainer.clientHeight;
            const scaleX = containerWidth / currentImageBitmap.width;
            const scaleY = containerHeight / currentImageBitmap.height;
            viewState.scale = Math.min(scaleX, scaleY, 1);
            viewState.x = (containerWidth - currentImageBitmap.width * viewState.scale) / 2;
            viewState.y = (containerHeight - currentImageBitmap.height * viewState.scale) / 2;
            
            draw();
            statusDiv.textContent = "Готово! Зум: колесико, Движение: мышь.";
        } catch (e) {
            console.error(e);
            statusDiv.textContent = "Ошибка декодирования.";
        }
    };

    function draw() {
        if (!currentImageBitmap || modal.style.display === "none") return;
        
        viewerCanvas.width = modalContainer.clientWidth;
        viewerCanvas.height = modalContainer.clientHeight;
        vCtx.fillStyle = "#111";
        vCtx.fillRect(0, 0, viewerCanvas.width, viewerCanvas.height);
        
        vCtx.imageSmoothingEnabled = viewState.scale < 1;
        vCtx.drawImage(currentImageBitmap, viewState.x, viewState.y, currentImageBitmap.width * viewState.scale, currentImageBitmap.height * viewState.scale);
    }

    modalContainer.onmousedown = (e) => {
        viewState.isDragging = true;
        viewState.lastMouseX = e.clientX;
        viewState.lastMouseY = e.clientY;
        modalContainer.style.cursor = "grabbing";
    };

    window.addEventListener('mousemove', (e) => {
        if (!viewState.isDragging) return;
        viewState.x += e.clientX - viewState.lastMouseX;
        viewState.y += e.clientY - viewState.lastMouseY;
        viewState.lastMouseX = e.clientX;
        viewState.lastMouseY = e.clientY;
        draw();
    });

    window.addEventListener('mouseup', () => {
        viewState.isDragging = false;
        modalContainer.style.cursor = "grab";
    });

    modalContainer.onwheel = (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? 0.8 : 1.2;
        const rect = modalContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const imgX = (mouseX - viewState.x) / viewState.scale;
        const imgY = (mouseY - viewState.y) / viewState.scale;
        
        viewState.scale *= zoomFactor;
        viewState.scale = Math.max(0.01, Math.min(viewState.scale, 80));
        
        viewState.x = mouseX - imgX * viewState.scale;
        viewState.y = mouseY - imgY * viewState.scale;
        draw();
    };

    zoomInBtn.onclick = () => { 
        const factor = 1.5;
        const cx = viewerCanvas.width/2, cy = viewerCanvas.height/2;
        const ix = (cx - viewState.x)/viewState.scale, iy = (cy - viewState.y)/viewState.scale;
        viewState.scale *= factor;
        viewState.x = cx - ix * viewState.scale; viewState.y = cy - iy * viewState.scale;
        draw();
    };

    zoomOutBtn.onclick = () => { 
        const factor = 0.7;
        const cx = viewerCanvas.width/2, cy = viewerCanvas.height/2;
        const ix = (cx - viewState.x)/viewState.scale, iy = (cy - viewState.y)/viewState.scale;
        viewState.scale *= factor;
        viewState.x = cx - ix * viewState.scale; viewState.y = cy - iy * viewState.scale;
        draw();
    };

    closeModal.onclick = () => {
        modal.style.display = "none";
        if (currentImageBitmap) { currentImageBitmap.close(); currentImageBitmap = null; }
    };

    downloadOriginalBtn.onclick = async () => {
        const item = uploadedResults.find(i => i.id === viewState.currentId);
        if (item) {
            let blob = item.file;
            if (typeof blob === "string") {
                const res = await fetch(blob);
                blob = await res.blob();
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = item.fileName;
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    // --- Экспорт / Импорт через ZIP (С ОПТИМИЗАЦИЕЙ РАЗМЕРА) ---
    document.getElementById('exportGallery').onclick = async () => {
        if (uploadedResults.length === 0) return alert("Галерея пуста");
        
        statusDiv.textContent = "Создание сжатого ZIP-архива... Это может занять пару минут.";
        const zip = new JSZip();
        const metadata = [];

        for (const item of uploadedResults) {
            // Исправляем: если в БД старые данные, берем их
            let fileToPack = item.file || item.dataUrl;
            if (!fileToPack) continue;

            // Конвертируем строку в Blob если нужно
            if (typeof fileToPack === "string") {
                const res = await fetch(fileToPack);
                fileToPack = await res.blob();
            }

            const fileExt = item.fileName.split('.').pop().toLowerCase();
            let storageName = `${item.id}.${fileExt}`;
            
            // Если файл тяжелее 20МБ и это не SVG — сжимаем его в WebP
            if (fileToPack instanceof Blob && fileToPack.size > 20 * 1024 * 1024 && fileExt !== 'svg') {
                statusDiv.textContent = `Оптимизация: ${item.fileName}...`;
                const compressed = await shrinkImage(fileToPack);
                if (compressed && compressed.size < fileToPack.size) {
                    fileToPack = compressed;
                    storageName = `${item.id}.webp`;
                }
            }

            zip.file(`images/${storageName}`, fileToPack);
            metadata.push({
                id: item.id,
                fileName: item.fileName,
                rating: item.rating,
                thumbUrl: item.thumbUrl,
                storageName: storageName
            });
        }

        zip.file("metadata.json", JSON.stringify(metadata));

        const content = await zip.generateAsync({ 
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: { level: 9 }
        });

        const a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = `mosaic_gallery_optimized_${Date.now()}.zip`;
        a.click();
        statusDiv.textContent = "Оптимизированный ZIP-архив создан.";
    };

    async function shrinkImage(blob) {
        try {
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            return new Promise(r => canvas.toBlob(r, 'image/webp', 0.8)); // 80% качество WebP
        } catch (e) {
            console.warn("Сжатие не удалось:", e);
            return blob;
        }
    }

    document.getElementById('importGalleryInput').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        statusDiv.textContent = "Распаковка архива...";
        try {
            const zip = await JSZip.loadAsync(file);
            const metadataFile = await zip.file("metadata.json").async("string");
            const metadata = JSON.parse(metadataFile);

            const tx = db.transaction("gallery", "readwrite");
            const store = tx.objectStore("gallery");

            for (const item of metadata) {
                statusDiv.textContent = `Импорт: ${item.fileName}...`;
                const imageFile = await zip.file(`images/${item.storageName}`).async("blob");
                
                store.put({
                    id: item.id,
                    fileName: item.fileName,
                    rating: item.rating,
                    thumbUrl: item.thumbUrl,
                    file: imageFile
                });
            }

            tx.oncomplete = () => {
                loadFromLocal();
                alert("Импорт завершен! Тяжелые файлы были автоматически оптимизированы.");
                statusDiv.textContent = "Готово.";
            };
        } catch (err) {
            console.error(err);
            alert("Ошибка при чтении архива.");
        }
        e.target.value = "";
    };

    async function createThumbnail(file, size) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = size / Math.max(img.width, img.height);
                canvas.width = img.width * scale; canvas.height = img.height * scale;
                const c = canvas.getContext('2d');
                c.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.src = URL.createObjectURL(file);
        });
    }

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
        if (confirm("Удалить?")) {
            const tx = db.transaction("gallery", "readwrite");
            tx.objectStore("gallery").delete(id);
            tx.oncomplete = () => loadFromLocal();
        }
    };

    // --- Генерация (без изменений) ---
    let mosaicData = { cols: 0, rows: 0, cellSize: 0, grid: [], sources: [] };
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
                    alert('Выберите файлы.'); generateBtn.disabled = false; return;
                }
                statusDiv.textContent = 'Обработка пула...';
                sources = await processSourceImages(sourceInput.files, 150); 
                targetImgRaw = await loadImage(targetInput.files[0]);
            } else {
                const targetKw = document.getElementById('targetKeyword').value.trim() || 'nature';
                const sourceKw = document.getElementById('sourceKeyword').value.trim() || 'cat';
                const count = Math.min(parseInt(document.getElementById('sourceCount').value) || 100, 300);
                statusDiv.textContent = `Загрузка фото...`;
                const urls = [];
                for (let i = 0; i < count; i++) {
                    const seed = Math.floor(Math.random() * 1000000);
                    const rawUrl = `https://loremflickr.com/400/400/${encodeURIComponent(sourceKw)}?lock=${seed}`;
                    urls.push(`https://images.weserv.nl/?url=${encodeURIComponent(rawUrl)}&n=-1`);
                }
                sources = await processSourceUrlsParallel(urls, 150);
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

            resultCanvas.width = targetWidth * renderScale;
            resultCanvas.height = targetHeight * renderScale;
            ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);

            const rows = Math.floor(targetHeight / baseCellSize);
            const totalCells = cols * rows;
            let cellsDone = 0;
            let lastUsedIds = [];
            
            mosaicData = { cols, rows, cellSize: baseCellSize, finalCellSize, grid: [], sources, renderScale, width: targetWidth, height: targetHeight, keepOriginal, blendIntensity };

            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    const avgColor = getAverageColor(targetDataRaw, targetWidth, x * baseCellSize, y * baseCellSize, baseCellSize);
                    const bestMatch = findBestMatchUnique(avgColor, sources, lastUsedIds, 15);
                    const posX = x * finalCellSize, posY = y * finalCellSize;

                    ctx.drawImage(bestMatch.canvas, posX, posY, finalCellSize, finalCellSize);
                    if (!keepOriginal && blendIntensity > 0) {
                        ctx.save(); ctx.globalCompositeOperation = 'color'; ctx.globalAlpha = blendIntensity;
                        ctx.fillStyle = `rgb(${avgColor.r}, ${avgColor.g}, ${avgColor.b})`;
                        ctx.fillRect(posX, posY, finalCellSize, finalCellSize); ctx.restore();
                    }
                    mosaicData.grid.push({ x, y, sourceId: bestMatch.id, color: avgColor });
                    
                    cellsDone++;
                    if (cellsDone % 100 === 0) {
                        updateProgress(45 + (cellsDone / totalCells) * 55);
                        statusDiv.textContent = `Сборка: ${Math.round((cellsDone / totalCells) * 100)}%`;
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
            }
            statusDiv.textContent = 'Готово!';
            updateProgress(100);
            downloadOptions.style.display = 'flex';
        } catch (error) { statusDiv.textContent = 'Ошибка: ' + error.message; } finally { generateBtn.disabled = false; }
    });

    downloadSvgBtn.addEventListener('click', () => {
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${mosaicData.width} ${mosaicData.height}" width="${mosaicData.width * 5}" height="${mosaicData.height * 5}">`;
        svg += '<defs>';
        mosaicData.sources.forEach(s => {
            const dataUrl = s.canvas.toDataURL('image/jpeg', 0.85);
            svg += `<image id="img-${s.id}" width="${mosaicData.cellSize}" height="${mosaicData.cellSize}" xlink:href="${dataUrl}" />`;
        });
        svg += '</defs>';
        mosaicData.grid.forEach(cell => {
            const x = cell.x * mosaicData.cellSize, y = cell.y * mosaicData.cellSize;
            svg += `<use xlink:href="#img-${cell.sourceId}" x="${x}" y="${y}" />`;
            if (!mosaicData.keepOriginal && mosaicData.blendIntensity > 0) {
                svg += `<rect x="${x}" y="${y}" width="${mosaicData.cellSize}" height="${mosaicData.cellSize}" fill="rgb(${cell.color.r},${cell.color.g},${cell.color.b})" fill-opacity="${mosaicData.blendIntensity}" />`;
            }
        });
        svg += '</svg>';
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const a = document.createElement('a'); a.download = `mosaic_${Date.now()}.svg`; a.href = URL.createObjectURL(blob); a.click();
    });

    downloadBtn.addEventListener('click', () => {
        resultCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.download = `mosaic_${Date.now()}.png`; a.href = url; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
    });

    async function processSourceUrlsParallel(urls, size) {
        const pool = [];
        let completed = 0;
        for (let i = 0; i < urls.length; i += 6) {
            const batch = urls.slice(i, i + 6);
            await Promise.all(batch.map(async (url, idx) => {
                try {
                    const img = await loadImageRemote(url, 15000);
                    pool.push(createSourceItem(img, size, i + idx));
                    completed++; updateProgress((completed / urls.length) * 45);
                } catch (e) {}
            }));
        }
        return pool;
    }

    async function processSourceImages(files, size) {
        const pool = [];
        for (let i = 0; i < files.length; i++) {
            const img = await loadImage(files[i]);
            pool.push(createSourceItem(img, size, i));
            updateProgress((i / files.length) * 45);
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

    function loadImage(file) { return new Promise(resolve => { const r = new FileReader(); r.onload = e => { const img = new Image(); img.onload = () => resolve(img); img.src = e.target.result; }; r.readAsDataURL(file); }); }
    function loadImageRemote(url, timeoutMs = 20000) { return new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = "Anonymous"; const t = setTimeout(() => reject(new Error("Timeout")), timeoutMs); img.onload = () => { clearTimeout(t); resolve(img); }; img.onerror = () => { clearTimeout(t); reject(new Error("Error")); }; img.src = url; }); }
    function calculateAverageColor(data) { let r = 0, g = 0, b = 0; for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; } const c = data.length / 4 || 1; return { r: r / c, g: g / c, b: b / c }; }
    function getAverageColor(data, width, startX, startY, size) { let r = 0, g = 0, b = 0, c = 0; for (let y = startY; y < startY + size; y++) { for (let x = startX; x < startX + size; x++) { const i = (y * width + x) * 4; if (i < data.length) { r += data[i]; g += data[i + 1]; b += data[i + 2]; c++; } } } return { r: r / (c || 1), g: g / (c || 1), b: b / (c || 1) }; }
    function findBestMatchUnique(targetColor, pool, history, limit) { const list = pool.filter(p => !history.includes(p.id)).map(item => { const dr = targetColor.r - item.avgColor.r, dg = targetColor.g - item.avgColor.g, db = targetColor.b - item.avgColor.b; return { item, diff: 0.3*dr*dr + 0.59*dg*dg + 0.11*db*db }; }).sort((a, b) => a.diff - b.diff); const best = list[Math.floor(Math.random() * Math.min(5, list.length))].item; history.push(best.id); if (history.length > limit) history.shift(); return best; }
    function updateProgress(p) { progressBar.style.width = p + '%'; }
    function resetApp() { targetInput.value = ""; sourceInput.value = ""; document.getElementById('targetKeyword').value = ""; document.getElementById('sourceKeyword').value = ""; renderScaleInput.value = 4; keepOriginalInput.checked = true; blendControl.style.display = 'none'; statusDiv.textContent = 'Готов.'; progressContainer.style.display = 'none'; downloadOptions.style.display = 'none'; ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height); resultCanvas.width = 0; resultCanvas.height = 0; }
    resetApp();
    keepOriginalInput.addEventListener('change', () => blendControl.style.display = keepOriginalInput.checked ? 'none' : 'block');
});