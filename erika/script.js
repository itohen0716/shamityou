"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const moreButton = document.getElementById("moreButton");
  const moreContent = document.getElementById("moreContent");

  if (!(moreButton instanceof HTMLButtonElement) || !(moreContent instanceof HTMLElement)) {
    console.error("展開ボタンまたは表示領域が見つかりません。");
    return;
  }

  moreButton.addEventListener("click", () => {
    const isExpanded = moreButton.getAttribute("aria-expanded") === "true";
    const nextExpanded = !isExpanded;

    moreButton.setAttribute("aria-expanded", String(nextExpanded));
    moreContent.hidden = !nextExpanded;

    if (nextExpanded) {
      moreContent.classList.remove("is-visible");
      window.requestAnimationFrame(() => {
        moreContent.classList.add("is-visible");
        moreContent.scrollIntoView({
          behavior: "smooth",
          block: "nearest"
        });
      });
    } else {
      moreContent.classList.remove("is-visible");
    }
  });
});
