// extensions/image-upload-manager/assets/layout-builder.js

(function () {
  "use strict";

  const container = document.getElementById("photo-layout-builder");
  if (!container) return;

  const shop = container.dataset.shop;
  const productId = container.dataset.productId;
  const variantId = container.dataset.variantId;
  const appUrl = container.dataset.appUrl;

  // ─── State ───────────────────────────────────────────────────────────────
  const state = {
    layoutType: null,
    gridSize: null,
    files: [],
    uploadIds: [],
    compositionId: null,
    previewUrl: null,
  };

  let cropQueue = [];
  let cropQueueResults = [];
  let cropperInstance = null;

  // Dimensions committed by the FIRST image in a multi-image set
  // (set on Apply OR on "Use Original"). Every later image in the same
  // set is locked to match, keeping the whole grid consistent.
  let lockedCropDimensions = null;

  // ─── Elements ────────────────────────────────────────────────────────────
  const layoutTypeGroup = document.getElementById("plb-layout-type-group");
  const gridSizeGroup = document.getElementById("plb-grid-size-group");
  const gridSizeStep = document.querySelector('[data-step="grid-size"]');
  const uploadStep = document.querySelector('[data-step="upload"]');
  const previewStep = document.querySelector('[data-step="preview"]');
  const uploadLabel = document.getElementById("plb-upload-label");
  const uploadHint = document.getElementById("plb-upload-hint");
  const dropzone = document.getElementById("plb-dropzone");
  const fileInput = document.getElementById("plb-file-input");
  const thumbnails = document.getElementById("plb-thumbnails");
  const validationMsg = document.getElementById("plb-validation-message");
  const addToCartBtn = document.getElementById("plb-add-to-cart-btn");
  const statusEl = document.getElementById("plb-status");
  const previewBox = document.getElementById("plb-preview-box");

  function apiUrl(path) {
    const base = appUrl ? appUrl.replace(/\/$/, "") : "";
    return `${base}${path}`;
  }

  // ─── Required Image Count ────────────────────────────────────────────────

  function getRequiredImageCount() {
    if (state.layoutType === "split") return 1;
    if (state.layoutType === "collage") {
      if (state.gridSize === "1x1") return 1;
      if (state.gridSize === "2x2") return 4;
      if (state.gridSize === "3x3") return 9;
    }
    return 1;
  }

  function updateUploadStepLabel() {
    const required = getRequiredImageCount();
    if (state.layoutType === "split") {
      uploadLabel.textContent = "3. Upload Your Image";
      uploadHint.textContent = "Upload 1 image. It will be automatically divided into your selected grid.";
      fileInput.removeAttribute("multiple");
    } else {
      uploadLabel.textContent = `3. Upload Images (${required} required)`;
      uploadHint.textContent = `Upload exactly ${required} image${required > 1 ? "s" : ""} — one for each grid cell.`;
      required > 1
        ? fileInput.setAttribute("multiple", "multiple")
        : fileInput.removeAttribute("multiple");
    }
  }

  function showStep(el) { el.classList.remove("plb-step-hidden"); }
  function hideStep(el) { el.classList.add("plb-step-hidden"); }
  function setStatus(msg, type = "") {
    statusEl.textContent = msg;
    statusEl.className = "plb-status" + (type ? ` plb-status-${type}` : "");
  }

  // ─── Step 1: Layout Type ─────────────────────────────────────────────────

  layoutTypeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".plb-option-btn");
    if (!btn) return;
    layoutTypeGroup.querySelectorAll(".plb-option-btn").forEach((b) => b.classList.remove("plb-selected"));
    btn.classList.add("plb-selected");
    Object.assign(state, { layoutType: btn.dataset.value, gridSize: null, files: [], uploadIds: [], compositionId: null, previewUrl: null });
    lockedCropDimensions = null;
    thumbnails.innerHTML = "";
    gridSizeGroup.querySelectorAll(".plb-grid-btn").forEach((b) => b.classList.remove("plb-selected"));
    showStep(gridSizeStep);
    hideStep(uploadStep);
    hideStep(previewStep);
    addToCartBtn.disabled = true;
    validationMsg.textContent = "";
    setStatus("");
  });

  // ─── Step 2: Grid Size ───────────────────────────────────────────────────

  gridSizeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".plb-grid-btn");
    if (!btn) return;
    gridSizeGroup.querySelectorAll(".plb-grid-btn").forEach((b) => b.classList.remove("plb-selected"));
    btn.classList.add("plb-selected");
    Object.assign(state, { gridSize: btn.dataset.value, files: [], uploadIds: [], compositionId: null, previewUrl: null });
    lockedCropDimensions = null;
    thumbnails.innerHTML = "";
    fileInput.value = "";
    updateUploadStepLabel();
    showStep(uploadStep);
    hideStep(previewStep);
    addToCartBtn.disabled = true;
    validationMsg.textContent = "";
    setStatus("");
  });

  // ─── Dropzone ────────────────────────────────────────────────────────────

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("plb-dragover"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("plb-dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("plb-dragover");
    handleFiles(Array.from(e.dataTransfer.files));
  });
  fileInput.addEventListener("change", (e) => handleFiles(Array.from(e.target.files)));

  // ─── File Handling ────────────────────────────────────────────────────────

  const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  const MAX_FILE_SIZE_MB = 10;

  function handleFiles(newFiles) {
    const required = getRequiredImageCount();
    const validFiles = [];
    for (const file of newFiles) {
      if (!ALLOWED_TYPES.includes(file.type)) { setStatus(`"${file.name}" is not a supported file type.`, "error"); continue; }
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) { setStatus(`"${file.name}" exceeds ${MAX_FILE_SIZE_MB}MB.`, "error"); continue; }
      validFiles.push(file);
    }
    if (!validFiles.length) return;
    cropQueue = validFiles.slice(0, required - (required === 1 ? 0 : state.files.length));
    cropQueueResults = [];
    processNextCropInQueue(required);
  }

  function processNextCropInQueue(required) {
    if (!cropQueue.length) {
      state.files = required === 1 ? cropQueueResults.slice(0, 1) : [...state.files, ...cropQueueResults].slice(0, required);
      state.uploadIds = [];
      state.compositionId = null;
      state.previewUrl = null;
      hideStep(previewStep);
      addToCartBtn.disabled = true;
      renderThumbnails();
      validateImageCount();
      return;
    }
    const nextFile = cropQueue.shift();
    openCropModal(nextFile, (resultFile) => {
      cropQueueResults.push(resultFile);
      processNextCropInQueue(required);
    });
  }

  function renderThumbnails() {
    thumbnails.innerHTML = "";
    state.files.forEach((file, index) => {
      const url = URL.createObjectURL(file);
      const thumb = document.createElement("div");
      thumb.className = "plb-thumbnail";
      thumb.innerHTML = `<img src="${url}" alt="${file.name}" /><button type="button" class="plb-thumbnail-remove" data-index="${index}">✕</button>`;
      thumbnails.appendChild(thumb);
    });
  }

  thumbnails.addEventListener("click", (e) => {
    const btn = e.target.closest(".plb-thumbnail-remove");
    if (!btn) return;
    state.files.splice(parseInt(btn.dataset.index, 10), 1);
    state.uploadIds = [];
    state.compositionId = null;
    hideStep(previewStep);
    addToCartBtn.disabled = true;
    if (!state.files.length) lockedCropDimensions = null;
    renderThumbnails();
    validateImageCount();
  });

  function validateImageCount() {
    const required = getRequiredImageCount();
    const current = state.files.length;
    if (!current) { validationMsg.textContent = ""; return; }
    if (current < required) { validationMsg.textContent = `${required - current} more image${required - current > 1 ? "s" : ""} needed.`; return; }
    if (current > required) { validationMsg.textContent = `Too many images. Only ${required} allowed.`; return; }
    validationMsg.textContent = "";
    runUploadAndCompose();
  }

  // ─── Upload + Compose ────────────────────────────────────────────────────

  async function uploadSingleFile(file) {
    if (!appUrl) throw new Error("App Backend URL is not configured. Set it in Theme Editor → Photo Layout Builder block settings.");
    const formData = new FormData();
    formData.append("image", file);
    const res = await fetch(apiUrl(`/api/upload?shop=${encodeURIComponent(shop)}`), { method: "POST", body: formData });
    if (!(res.headers.get("content-type") || "").includes("application/json")) throw new Error("Upload endpoint returned an unexpected response. Check the App Backend URL setting.");
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Upload failed");
    return data.uploadId;
  }

  async function runUploadAndCompose() {
    try {
      setStatus("Uploading images...", "loading");
      addToCartBtn.disabled = true;
      const uploadIds = [];
      for (const file of state.files) uploadIds.push(await uploadSingleFile(file));
      state.uploadIds = uploadIds;
      setStatus("Generating preview...", "loading");

      const res = await fetch(apiUrl("/api/compose"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop, layoutType: state.layoutType, gridSize: state.gridSize, uploadIds: state.uploadIds, productId, variantId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Composition failed");

      state.compositionId = data.compositionId;
      state.previewUrl = data.previewUrl;
      renderRealPreview(data.previewUrl, data.previewWidth, data.previewHeight);
      setStatus("Preview ready!", "success");
      showStep(previewStep);
      addToCartBtn.disabled = false;
    } catch (err) {
      console.error("Upload/Compose error:", err);
      setStatus(err.message || "Something went wrong. Please try again.", "error");
      addToCartBtn.disabled = true;
    }
  }

  // ─── Preview ─────────────────────────────────────────────────────────────
  // Bug 4 fix (frontend side): use the real previewWidth/previewHeight returned
  // by the server to set the frame's aspect-ratio. The server fix (image.processing.server.js)
  // ensures cells are no longer force-cropped to squares.

  function renderRealPreview(previewUrl, previewWidth, previewHeight) {
    previewBox.innerHTML = "";
    const frame = document.createElement("div");
    frame.className = "plb-preview-frame";
    // Always set aspect-ratio from real dimensions — never default to 1:1
    if (previewWidth && previewHeight) {
      frame.style.aspectRatio = `${previewWidth} / ${previewHeight}`;
    }
    const img = document.createElement("img");
    img.src = apiUrl(previewUrl);
    img.alt = "Your photo layout preview";
    img.className = "plb-preview-image";
    frame.appendChild(img);
    previewBox.appendChild(frame);
  }

  // ─── Add to Cart ─────────────────────────────────────────────────────────

  addToCartBtn.addEventListener("click", async () => {
    if (!state.compositionId || !state.previewUrl) { setStatus("Please complete your layout before adding to cart.", "error"); return; }
    try {
      addToCartBtn.disabled = true;
      setStatus("Adding to cart...", "loading");
      const res = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ id: variantId, quantity: 1, properties: { "Layout Type": state.layoutType === "split" ? "Split Photo Grid" : "Photo Collage", "Grid Size": state.gridSize, "_composition_id": state.compositionId, "_preview_url": state.previewUrl } }] }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.description || "Could not add to cart."); }
      setStatus("Added to cart!", "success");
      document.dispatchEvent(new CustomEvent("cart:refresh"));
      document.dispatchEvent(new CustomEvent("cart:updated"));
      setTimeout(() => { addToCartBtn.disabled = false; addToCartBtn.textContent = "Add Another to Cart"; }, 1200);
    } catch (err) {
      console.error("Add to cart error:", err);
      setStatus(err.message || "Could not add to cart. Please try again.", "error");
      addToCartBtn.disabled = false;
    }
  });

  // ─── Crop Modal Elements ─────────────────────────────────────────────────

  const cropModal = document.getElementById("plb-crop-modal");
  const cropImage = document.getElementById("plb-crop-image");
  const cropRatioGroup = document.getElementById("plb-crop-ratio-group");
  const cropCloseBtn = document.getElementById("plb-crop-close");
  const cropResetBtn = document.getElementById("plb-crop-reset-btn");
  const cropSkipBtn = document.getElementById("plb-crop-skip-btn");
  const cropApplyBtn = document.getElementById("plb-crop-apply-btn");
  const cropTabsGroup = document.getElementById("plb-crop-tabs");
  const cropPresetGroup = document.getElementById("plb-crop-preset-group");
  const customWidthInput = document.getElementById("plb-custom-width");
  const customHeightInput = document.getElementById("plb-custom-height");
  const customPixelApplyBtn = document.getElementById("plb-custom-pixel-apply");
  const cropLockedNote = document.getElementById("plb-crop-locked-note");

  let currentCropFile = null;
  let currentCropCallback = null;
  let targetOutputSize = null; // { width, height } or null → natural resolution

  function switchCropTab(tabName) {
    cropTabsGroup.querySelectorAll(".plb-crop-tab").forEach((t) =>
      t.classList.toggle("plb-selected", t.dataset.tab === tabName)
    );
    cropRatioGroup.classList.toggle("plb-step-hidden", tabName !== "default");
    cropPresetGroup.classList.toggle("plb-step-hidden", tabName !== "presets");
  }

  cropTabsGroup.addEventListener("click", (e) => {
    const tab = e.target.closest(".plb-crop-tab");
    if (tab) switchCropTab(tab.dataset.tab);
  });

  // ─── Open Crop Modal ──────────────────────────────────────────────────────
  // Bug 1 fix: assign cropImage.onload BEFORE setting cropImage.src.
  // Previously src was set first — if the browser loaded the object URL
  // synchronously (common on repeat opens), onload never fired, leaving
  // cropperInstance null and making Apply silently fall back to the
  // original file every time.

  function openCropModal(file, onComplete) {
    currentCropFile = file;
    currentCropCallback = onComplete;

    // For multi-image sets every image after the first inherits the lock
    const isLocked = lockedCropDimensions !== null && getRequiredImageCount() > 1;
    targetOutputSize = isLocked ? { ...lockedCropDimensions } : null;

    cropModal.classList.remove("plb-crop-modal-hidden");

    if (isLocked) {
      hideStep(cropTabsGroup);
      hideStep(cropRatioGroup);
      hideStep(cropPresetGroup);
      hideStep(cropSkipBtn);
      if (cropLockedNote) {
        cropLockedNote.textContent = `Dimensions locked to ${lockedCropDimensions.width}×${lockedCropDimensions.height}px to match your first photo.`;
        showStep(cropLockedNote);
      }
    } else {
      switchCropTab("default");
      showStep(cropTabsGroup);
      showStep(cropSkipBtn);
      if (cropLockedNote) hideStep(cropLockedNote);
      cropRatioGroup.querySelectorAll(".plb-ratio-btn").forEach((b) => b.classList.remove("plb-selected"));
      cropRatioGroup.querySelector('[data-ratio="free"]').classList.add("plb-selected");
      cropPresetGroup.querySelectorAll(".plb-preset-btn").forEach((b) => b.classList.remove("plb-selected"));
      if (customWidthInput) customWidthInput.value = "";
      if (customHeightInput) customHeightInput.value = "";
    }

    // BUG 1 FIX: onload must be assigned BEFORE src is set so the handler
    // is always in place, even when the browser resolves the object URL
    // synchronously from its internal cache.
    cropImage.onload = () => {
      if (cropperInstance) cropperInstance.destroy();
      cropperInstance = new Cropper(cropImage, {
        viewMode: 1,
        autoCropArea: 1,
        responsive: true,
        background: false,
        aspectRatio: isLocked ? lockedCropDimensions.width / lockedCropDimensions.height : NaN,
      });
    };

    // Set src AFTER onload is registered
    cropImage.src = URL.createObjectURL(file);
  }

  function closeCropModal() {
    cropModal.classList.add("plb-crop-modal-hidden");
    if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
    // Revoke and clear the object URL
    if (cropImage.src) { URL.revokeObjectURL(cropImage.src); cropImage.src = ""; }
  }

  // ─── Tab 1: Aspect Ratios ─────────────────────────────────────────────────

  cropRatioGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".plb-ratio-btn");
    if (!btn || !cropperInstance) return;
    cropRatioGroup.querySelectorAll(".plb-ratio-btn").forEach((b) => b.classList.remove("plb-selected"));
    btn.classList.add("plb-selected");
    targetOutputSize = null;
    cropPresetGroup.querySelectorAll(".plb-preset-btn").forEach((b) => b.classList.remove("plb-selected"));
    cropperInstance.setAspectRatio(btn.dataset.ratio === "free" ? NaN : parseFloat(btn.dataset.ratio));
  });

  // ─── Tab 2: Preset Sizes ─────────────────────────────────────────────────

  function applyPixelTarget(w, h) {
    if (!cropperInstance || !w || !h || w <= 0 || h <= 0) return;
    targetOutputSize = { width: w, height: h };
    cropperInstance.setAspectRatio(w / h);
    cropRatioGroup.querySelectorAll(".plb-ratio-btn").forEach((b) => b.classList.remove("plb-selected"));
  }

  cropPresetGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".plb-preset-btn");
    if (!btn) return;
    cropPresetGroup.querySelectorAll(".plb-preset-btn").forEach((b) => b.classList.remove("plb-selected"));
    btn.classList.add("plb-selected");
    applyPixelTarget(parseInt(btn.dataset.width, 10), parseInt(btn.dataset.height, 10));
  });

  if (customPixelApplyBtn) {
    customPixelApplyBtn.addEventListener("click", () => {
      const w = parseInt(customWidthInput.value, 10);
      const h = parseInt(customHeightInput.value, 10);
      if (!w || !h) { setStatus("Enter both width and height in pixels.", "error"); return; }
      cropPresetGroup.querySelectorAll(".plb-preset-btn").forEach((b) => b.classList.remove("plb-selected"));
      applyPixelTarget(w, h);
      setStatus("");
    });
  }

  // ─── Reset ────────────────────────────────────────────────────────────────

  if (cropResetBtn) {
    cropResetBtn.addEventListener("click", () => {
      if (!cropperInstance) return;
      const isLocked = lockedCropDimensions !== null && getRequiredImageCount() > 1;
      if (isLocked) {
        cropperInstance.setAspectRatio(lockedCropDimensions.width / lockedCropDimensions.height);
      } else {
        targetOutputSize = null;
        cropperInstance.setAspectRatio(NaN);
        switchCropTab("default");
        cropRatioGroup.querySelectorAll(".plb-ratio-btn").forEach((b) => b.classList.remove("plb-selected"));
        cropRatioGroup.querySelector('[data-ratio="free"]').classList.add("plb-selected");
        cropPresetGroup.querySelectorAll(".plb-preset-btn").forEach((b) => b.classList.remove("plb-selected"));
        if (customWidthInput) customWidthInput.value = "";
        if (customHeightInput) customHeightInput.value = "";
      }
      cropperInstance.reset();
    });
  }

  // ─── Close (✕) ────────────────────────────────────────────────────────────
  // Bug 3 fix: closing without clicking Apply or "Use Original" now locks
  // the natural image dimensions (same as "Use Original") so subsequent
  // images in the queue still get the correct locked-dimensions modal.

  cropCloseBtn.addEventListener("click", () => {
    commitSkipAndContinue();
  });

  // ─── Use Original ─────────────────────────────────────────────────────────
  // Bug 2 fix: "Use Original" now records the image's natural pixel dimensions
  // as the lock for the set — previously the lock was only set on Apply, so
  // if the first N images used "Use Original" and the last image applied a
  // crop, only that last image's size was locked (and only retroactively).

  cropSkipBtn.addEventListener("click", () => {
    commitSkipAndContinue();
  });

  // Shared logic for skip / close: lock natural image dimensions (first image
  // in set only), then pass the original file to the queue callback.
  function commitSkipAndContinue() {
    if (!lockedCropDimensions && getRequiredImageCount() > 1) {
      // cropImage.naturalWidth/Height are available because onload already fired
      const nw = cropImage.naturalWidth;
      const nh = cropImage.naturalHeight;
      if (nw && nh) lockedCropDimensions = { width: nw, height: nh };
    }
    finishCrop(currentCropFile);
  }

  // ─── Apply Crop ───────────────────────────────────────────────────────────
  // Bug 1 fix (part 2): guard against getCroppedCanvas() returning null and
  // against toBlob() receiving a null blob (canvas tainted / out-of-memory).
  // Lock dimensions synchronously before the async toBlob callback.

  cropApplyBtn.addEventListener("click", () => {
    if (!cropperInstance) {
      // Cropper never initialised (shouldn't happen after Bug 1 fix, but
      // defensive fallback): treat as "Use Original".
      commitSkipAndContinue();
      return;
    }

    const exportOptions = targetOutputSize
      ? { width: targetOutputSize.width, height: targetOutputSize.height, imageSmoothingQuality: "high" }
      : { maxWidth: 2048, maxHeight: 2048, imageSmoothingQuality: "high" };

    const canvas = cropperInstance.getCroppedCanvas(exportOptions);
    if (!canvas) {
      console.warn("getCroppedCanvas() returned null — falling back to original.");
      commitSkipAndContinue();
      return;
    }

    // Lock BEFORE toBlob (async) so the value is in place for any code
    // that runs between now and the callback.
    if (!lockedCropDimensions && getRequiredImageCount() > 1) {
      lockedCropDimensions = { width: canvas.width, height: canvas.height };
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        console.warn("canvas.toBlob() produced null — falling back to original.");
        finishCrop(currentCropFile);
        return;
      }
      finishCrop(new File([blob], currentCropFile.name, { type: currentCropFile.type || "image/jpeg" }));
    }, currentCropFile.type || "image/jpeg", 0.92);
  });

  function finishCrop(fileToUse) {
    const cb = currentCropCallback;
    closeCropModal();
    currentCropFile = null;
    currentCropCallback = null;
    if (cb) cb(fileToUse);
  }

})();