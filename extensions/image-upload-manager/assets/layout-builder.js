// extensions/image-upload-manager/assets/layout-builder.js

(function () {
  "use strict";

  const container = document.getElementById("photo-layout-builder");
  if (!container) return;

  const shop = container.dataset.shop;
  const productId = container.dataset.productId;
  const variantId = container.dataset.variantId;
  const appUrl = container.dataset.appUrl; // set in Theme Editor block settings

  // ─── State ───────────────────────────────────────────────────────────────
  const state = {
    layoutType: null,
    gridSize: null,
    files: [],
    uploadIds: [],   // populated after each file uploads successfully
    compositionId: null,
    previewUrl: null,
  };
  let cropQueue = [];
  let cropQueueResults = [];
  let cropperInstance = null;

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

  // ─── API Base URL ────────────────────────────────────────────────────────
  // appUrl comes from the block setting set in Theme Editor.
  // Falls back to relative paths if same-origin (rare for storefronts).

  function apiUrl(path) {
    const base = appUrl ? appUrl.replace(/\/$/, "") : "";
    return `${base}${path}`;
  }

  // ─── Required Image Count Logic ─────────────────────────────────────────

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
      if (required > 1) {
        fileInput.setAttribute("multiple", "multiple");
      } else {
        fileInput.removeAttribute("multiple");
      }
    }
  }

  function showStep(stepEl) {
    stepEl.classList.remove("plb-step-hidden");
  }

  function setStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = "plb-status" + (type ? ` plb-status-${type}` : "");
  }

  // ─── Layout Type Selection ──────────────────────────────────────────────

  layoutTypeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".plb-option-btn");
    if (!btn) return;

    layoutTypeGroup.querySelectorAll(".plb-option-btn").forEach((b) =>
      b.classList.remove("plb-selected")
    );
    btn.classList.add("plb-selected");

    state.layoutType = btn.dataset.value;
    state.gridSize = null;
    state.files = [];
    state.uploadIds = [];
    state.compositionId = null;
    state.previewUrl = null;

    thumbnails.innerHTML = "";
    gridSizeGroup.querySelectorAll(".plb-grid-btn").forEach((b) =>
      b.classList.remove("plb-selected")
    );

    showStep(gridSizeStep);
    uploadStep.classList.add("plb-step-hidden");
    previewStep.classList.add("plb-step-hidden");
    addToCartBtn.disabled = true;
    validationMsg.textContent = "";
    setStatus("");
  });

  // ─── Grid Size Selection ─────────────────────────────────────────────────

  gridSizeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".plb-grid-btn");
    if (!btn) return;

    gridSizeGroup.querySelectorAll(".plb-grid-btn").forEach((b) =>
      b.classList.remove("plb-selected")
    );
    btn.classList.add("plb-selected");

    state.gridSize = btn.dataset.value;
    state.files = [];
    state.uploadIds = [];
    state.compositionId = null;
    state.previewUrl = null;

    thumbnails.innerHTML = "";
    fileInput.value = "";

    updateUploadStepLabel();
    showStep(uploadStep);
    previewStep.classList.add("plb-step-hidden");
    addToCartBtn.disabled = true;
    validationMsg.textContent = "";
    setStatus("");
  });

  // ─── Dropzone Interaction ───────────────────────────────────────────────

  dropzone.addEventListener("click", () => fileInput.click());

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("plb-dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("plb-dragover");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("plb-dragover");
    handleFiles(Array.from(e.dataTransfer.files));
  });

  fileInput.addEventListener("change", (e) => {
    handleFiles(Array.from(e.target.files));
  });

  // ─── File Handling & Validation ─────────────────────────────────────────

  const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  const MAX_FILE_SIZE_MB = 10;

  function handleFiles(newFiles) {
    const required = getRequiredImageCount();
    const validFiles = [];

    for (const file of newFiles) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        setStatus(`"${file.name}" is not a supported file type.`, "error");
        continue;
      }
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setStatus(`"${file.name}" exceeds ${MAX_FILE_SIZE_MB}MB.`, "error");
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    // Queue files through the crop modal, one at a time.
    // Whatever comes out (cropped or original) becomes the final file.
    cropQueue = validFiles.slice(0, required - (required === 1 ? 0 : state.files.length));
    cropQueueResults = [];
    processNextCropInQueue(required);
  }

  function processNextCropInQueue(required) {
    if (cropQueue.length === 0) {
      // All files in this batch have been through the modal (cropped or skipped)
      if (required === 1) {
        state.files = cropQueueResults.slice(0, 1);
      } else {
        state.files = [...state.files, ...cropQueueResults].slice(0, required);
      }

      state.uploadIds = [];
      state.compositionId = null;
      state.previewUrl = null;
      previewStep.classList.add("plb-step-hidden");
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
      thumb.innerHTML = `
        <img src="${url}" alt="${file.name}" />
        <button type="button" class="plb-thumbnail-remove" data-index="${index}">✕</button>
      `;
      thumbnails.appendChild(thumb);
    });
  }

  thumbnails.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".plb-thumbnail-remove");
    if (!removeBtn) return;
    const index = parseInt(removeBtn.dataset.index, 10);
    state.files.splice(index, 1);
    state.uploadIds = [];
    state.compositionId = null;
    previewStep.classList.add("plb-step-hidden");
    addToCartBtn.disabled = true;
    renderThumbnails();
    validateImageCount();
  });

  function validateImageCount() {
    const required = getRequiredImageCount();
    const current = state.files.length;

    if (current === 0) {
      validationMsg.textContent = "";
      return;
    }
    if (current < required) {
      validationMsg.textContent = `${required - current} more image${required - current > 1 ? "s" : ""} needed.`;
      return;
    }
    if (current > required) {
      validationMsg.textContent = `Too many images. Only ${required} allowed.`;
      return;
    }

    // Exact match — trigger real upload + compose
    validationMsg.textContent = "";
    runUploadAndCompose();
  }

  // ─── Real Upload + Compose Pipeline ─────────────────────────────────────

  async function uploadSingleFile(file) {
    if (!appUrl) {
      throw new Error("App Backend URL is not configured. Set it in Theme Editor → Photo Layout Builder block settings.");
    }

    const formData = new FormData();
    formData.append("image", file);

    const response = await fetch(apiUrl(`/api/upload?shop=${encodeURIComponent(shop)}`), {
      method: "POST",
      body: formData,
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Upload endpoint returned an unexpected response. Check the App Backend URL setting.");
    }

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Upload failed");
    }

    return data.uploadId;
  }

  async function runUploadAndCompose() {
    try {
      setStatus("Uploading images...", "loading");
      addToCartBtn.disabled = true;

      // Upload each file, collect uploadIds in order
      const uploadIds = [];
      for (const file of state.files) {
        const uploadId = await uploadSingleFile(file);
        uploadIds.push(uploadId);
      }
      state.uploadIds = uploadIds;

      setStatus("Generating preview...", "loading");

      const composeResponse = await fetch(apiUrl("/api/compose"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop,
          layoutType: state.layoutType,
          gridSize: state.gridSize,
          uploadIds: state.uploadIds,
          productId,
          variantId,
        }),
      });

      const composeData = await composeResponse.json();

      if (!composeResponse.ok || !composeData.success) {
        throw new Error(composeData.error || "Composition failed");
      }

      state.compositionId = composeData.compositionId;
      state.previewUrl = composeData.previewUrl;

      renderRealPreview(composeData.previewUrl);

      setStatus("Preview ready!", "success");
      showStep(previewStep);
      addToCartBtn.disabled = false;

    } catch (error) {
      console.error("Upload/Compose error:", error);
      setStatus(error.message || "Something went wrong. Please try again.", "error");
      addToCartBtn.disabled = true;
    }
  }

  function renderRealPreview(previewUrl) {
    previewBox.innerHTML = "";

    const frame = document.createElement("div");
    frame.className = "plb-preview-frame";

    const img = document.createElement("img");
    img.src = apiUrl(previewUrl); // prefix with appUrl, same as API calls
    img.alt = "Your photo layout preview";
    img.className = "plb-preview-image";

    frame.appendChild(img);
    previewBox.appendChild(frame);
  }

  // ─── Add to Cart ─────────────────────────────────────────────────────────

  addToCartBtn.addEventListener("click", async () => {
    if (!state.compositionId || !state.previewUrl) {
      setStatus("Please complete your layout before adding to cart.", "error");
      return;
    }

    try {
      addToCartBtn.disabled = true;
      setStatus("Adding to cart...", "loading");

      const layoutTypeLabel = state.layoutType === "split"
        ? "Split Photo Grid"
        : "Photo Collage";

      const response = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              id: variantId,
              quantity: 1,
              properties: {
                "Layout Type": layoutTypeLabel,
                "Grid Size": state.gridSize,
                "_composition_id": state.compositionId,
                "_preview_url": state.previewUrl,
              },
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.description || "Could not add to cart.");
      }

      setStatus("Added to cart!", "success");

      // Notify the theme's cart drawer/icon to update, if the theme supports it
      document.dispatchEvent(new CustomEvent("cart:refresh"));
      document.dispatchEvent(new CustomEvent("cart:updated"));

      // Re-enable after a short delay in case customer wants to build another
      setTimeout(() => {
        addToCartBtn.disabled = false;
        addToCartBtn.textContent = "Add Another to Cart";
      }, 1200);

    } catch (error) {
      console.error("Add to cart error:", error);
      setStatus(error.message || "Could not add to cart. Please try again.", "error");
      addToCartBtn.disabled = false;
    }
  });

  // ─── Crop Editor Modal ───────────────────────────────────────────────────

  const cropModal = document.getElementById("plb-crop-modal");
  const cropImage = document.getElementById("plb-crop-image");
  const cropRatioGroup = document.getElementById("plb-crop-ratio-group");
  const cropCloseBtn = document.getElementById("plb-crop-close");
  const cropSkipBtn = document.getElementById("plb-crop-skip-btn");
  const cropApplyBtn = document.getElementById("plb-crop-apply-btn");

  // New: tabs + preset/custom-pixel elements
  const cropTabsGroup = document.getElementById("plb-crop-tabs");
  const cropPresetGroup = document.getElementById("plb-crop-preset-group");
  const customWidthInput = document.getElementById("plb-custom-width");
  const customHeightInput = document.getElementById("plb-custom-height");
  const customPixelApplyBtn = document.getElementById("plb-custom-pixel-apply");

  let currentCropFile = null;
  let currentCropCallback = null;
  let targetOutputSize = null; // { width, height } in real px, or null = natural crop resolution

  function switchCropTab(tabName) {
    cropTabsGroup.querySelectorAll(".plb-crop-tab").forEach((tab) => {
      tab.classList.toggle("plb-selected", tab.dataset.tab === tabName);
    });
    cropRatioGroup.classList.toggle("plb-step-hidden", tabName !== "default");
    cropPresetGroup.classList.toggle("plb-step-hidden", tabName !== "presets");
  }

  cropTabsGroup.addEventListener("click", (e) => {
    const tabBtn = e.target.closest(".plb-crop-tab");
    if (!tabBtn) return;
    switchCropTab(tabBtn.dataset.tab);
  });

  function openCropModal(file, onComplete) {
    currentCropFile = file;
    currentCropCallback = onComplete;
    targetOutputSize = null; // reset any previously chosen exact output size

    const objectUrl = URL.createObjectURL(file);
    cropImage.src = objectUrl;

    cropModal.classList.remove("plb-crop-modal-hidden");

    // Always reopen on the "default" tab, with Free selected
    switchCropTab("default");

    cropRatioGroup.querySelectorAll(".plb-ratio-btn").forEach((b) =>
      b.classList.remove("plb-selected")
    );
    cropRatioGroup.querySelector('[data-ratio="free"]').classList.add("plb-selected");

    cropPresetGroup.querySelectorAll(".plb-preset-btn").forEach((b) =>
      b.classList.remove("plb-selected")
    );
    customWidthInput.value = "";
    customHeightInput.value = "";

    // Cropper.js must initialize AFTER the image has loaded into the DOM
    cropImage.onload = () => {
      if (cropperInstance) {
        cropperInstance.destroy();
      }
      cropperInstance = new Cropper(cropImage, {
        viewMode: 1,
        autoCropArea: 1,
        responsive: true,
        background: false,
        aspectRatio: NaN, // Free by default
      });
    };
  }

  function closeCropModal() {
    cropModal.classList.add("plb-crop-modal-hidden");
    if (cropperInstance) {
      cropperInstance.destroy();
      cropperInstance = null;
    }
    if (cropImage.src) {
      URL.revokeObjectURL(cropImage.src);
      cropImage.src = "";
    }
  }

  cropCloseBtn.addEventListener("click", () => {
    // Treat closing without choosing as "skip" so the flow isn't stuck
    finishCrop(currentCropFile);
  });

  // ─── Tab 1: Default Aspect Ratios ───────────────────────────────────────

  cropRatioGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".plb-ratio-btn");
    if (!btn || !cropperInstance) return;

    cropRatioGroup.querySelectorAll(".plb-ratio-btn").forEach((b) =>
      b.classList.remove("plb-selected")
    );
    btn.classList.add("plb-selected");

    // Switching back to a default ratio clears any fixed pixel output target —
    // crop will export at its natural cropped resolution again.
    targetOutputSize = null;
    cropPresetGroup.querySelectorAll(".plb-preset-btn").forEach((b) =>
      b.classList.remove("plb-selected")
    );

    const ratioValue = btn.dataset.ratio;
    cropperInstance.setAspectRatio(ratioValue === "free" ? NaN : parseFloat(ratioValue));
  });

  // ─── Tab 2: Preset Sizes ─────────────────────────────────────────────────

  function applyPixelTarget(width, height) {
    if (!cropperInstance || !width || !height || width <= 0 || height <= 0) return;

    targetOutputSize = { width, height };
    cropperInstance.setAspectRatio(width / height);

    // Clear "Default" tab selection since a preset/custom size is now active
    cropRatioGroup.querySelectorAll(".plb-ratio-btn").forEach((b) =>
      b.classList.remove("plb-selected")
    );
  }

  cropPresetGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".plb-preset-btn");
    if (!btn) return;

    cropPresetGroup.querySelectorAll(".plb-preset-btn").forEach((b) =>
      b.classList.remove("plb-selected")
    );
    btn.classList.add("plb-selected");

    const width = parseInt(btn.dataset.width, 10);
    const height = parseInt(btn.dataset.height, 10);
    applyPixelTarget(width, height);
  });

  customPixelApplyBtn.addEventListener("click", () => {
    const width = parseInt(customWidthInput.value, 10);
    const height = parseInt(customHeightInput.value, 10);

    if (!width || !height) {
      setStatus("Enter both width and height in pixels.", "error");
      return;
    }

    cropPresetGroup.querySelectorAll(".plb-preset-btn").forEach((b) =>
      b.classList.remove("plb-selected")
    );
    applyPixelTarget(width, height);
    setStatus("");
  });

  // ─── Skip / Apply ────────────────────────────────────────────────────────

  cropSkipBtn.addEventListener("click", () => {
    finishCrop(currentCropFile);
  });

  cropApplyBtn.addEventListener("click", () => {
    if (!cropperInstance) {
      finishCrop(currentCropFile);
      return;
    }

    // If a preset/custom pixel target is active, export at THOSE exact
    // dimensions. Otherwise fall back to the original natural-resolution
    // behavior (capped at 2048 for sane file sizes).
    const exportOptions = targetOutputSize
      ? {
        width: targetOutputSize.width,
        height: targetOutputSize.height,
        imageSmoothingQuality: "high",
      }
      : {
        maxWidth: 2048,
        maxHeight: 2048,
        imageSmoothingQuality: "high",
      };

    const canvas = cropperInstance.getCroppedCanvas(exportOptions);

    canvas.toBlob((blob) => {
      // Wrap the Blob as a File so it behaves identically downstream
      const croppedFile = new File(
        [blob],
        currentCropFile.name,
        { type: currentCropFile.type || "image/jpeg" }
      );
      finishCrop(croppedFile);
    }, currentCropFile.type || "image/jpeg", 0.92);
  });

  function finishCrop(fileToUse) {
    const callback = currentCropCallback;
    closeCropModal();
    currentCropFile = null;
    currentCropCallback = null;
    if (callback) callback(fileToUse);
  }

})();