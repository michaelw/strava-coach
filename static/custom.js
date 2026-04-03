(() => {
  const promptBlock = document.querySelector(".prompt-source [data-prompt-source-block]");
  if (!promptBlock || !navigator.clipboard) {
    return;
  }

  const textNode = promptBlock.querySelector("code");
  if (!textNode) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "prompt-copy-button";
  button.textContent = "Copy";
  button.setAttribute("aria-label", "Copy prompt text");

  const toast = document.createElement("span");
  toast.className = "prompt-copy-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = "Copied!";

  promptBlock.appendChild(button);
  promptBlock.appendChild(toast);

  let hideToastTimer = null;

  const showToast = (message) => {
    toast.textContent = message;
    toast.classList.add("is-visible");

    if (hideToastTimer) {
      window.clearTimeout(hideToastTimer);
    }

    hideToastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 1400);
  };

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(textNode.textContent || "");
      showToast("Copied!");
    } catch (_error) {
      showToast("Copy failed");
    }
  });
})();
