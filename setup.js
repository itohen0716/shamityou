(() => {
  "use strict";

  const MODES = {
    hon: "本調子",
    niage: "二上り",
    sansage: "三下り"
  };

  let tuning = localStorage.getItem("shian-tuning") || "hon";
  const countSelect = document.getElementById("honCount");
  const summary = document.getElementById("settingSummary");

  function updateSummary() {
    const count = Number(countSelect.value);
    summary.textContent = `${count}本・${MODES[tuning]}`;
    localStorage.setItem("shian-count", String(count));
    localStorage.setItem("shian-tuning", tuning);
  }

  function restore() {
    const savedCount = localStorage.getItem("shian-count");
    if (savedCount) countSelect.value = savedCount;

    document.querySelectorAll("[data-tuning]").forEach(button => {
      const active = button.dataset.tuning === tuning;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    updateSummary();
  }

  document.querySelectorAll("[data-tuning]").forEach(button => {
    button.addEventListener("click", () => {
      tuning = button.dataset.tuning;
      document.querySelectorAll("[data-tuning]").forEach(item => {
        const active = item.dataset.tuning === tuning;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      updateSummary();
    });
  });

  countSelect.addEventListener("change", updateSummary);

  document.querySelectorAll("[data-practice]").forEach(button => {
    button.addEventListener("click", () => {
      const practice = button.dataset.practice;
      localStorage.setItem("shian-practice", practice);
      localStorage.setItem("shian-count", countSelect.value);
      localStorage.setItem("shian-tuning", tuning);
      window.location.href = "./tuning-play.html";
    });
  });

  restore();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
  }
})();