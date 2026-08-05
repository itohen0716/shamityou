(function () {
  "use strict";

  const progressBar = document.getElementById("reading-progress-bar");
  const floatingTop = document.getElementById("floating-top");
  const questionLinks = Array.from(document.querySelectorAll('.question-link[href^="#"]'));
  const storyCards = Array.from(document.querySelectorAll(".story-card[id]"));

  function updateScrollUi() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollable = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    const progress = Math.min(Math.max(scrollTop / scrollable, 0), 1);

    if (progressBar) {
      progressBar.style.width = `${(progress * 100).toFixed(2)}%`;
    }

    if (floatingTop) {
      floatingTop.classList.toggle("is-visible", scrollTop > 520);
    }
  }

  function focusHashTarget(hash) {
    if (!hash || hash === "#") {
      return;
    }

    let target;
    try {
      target = document.querySelector(hash);
    } catch (error) {
      console.warn("移動先を確認できませんでした。", error);
      return;
    }

    if (!(target instanceof HTMLElement)) {
      return;
    }

    window.setTimeout(function () {
      target.focus({ preventScroll: true });
    }, 450);
  }

  questionLinks.forEach(function (link) {
    link.addEventListener("click", function () {
      focusHashTarget(link.hash);
    });
  });

  if ("IntersectionObserver" in window && storyCards.length > 0) {
    const observer = new IntersectionObserver(
      function (entries) {
        const visibleEntry = entries
          .filter(function (entry) {
            return entry.isIntersecting;
          })
          .sort(function (a, b) {
            return b.intersectionRatio - a.intersectionRatio;
          })[0];

        if (!visibleEntry) {
          return;
        }

        const activeHash = `#${visibleEntry.target.id}`;
        questionLinks.forEach(function (link) {
          const isActive = link.hash === activeHash;
          link.classList.toggle("is-active", isActive);
          if (isActive) {
            link.setAttribute("aria-current", "true");
          } else {
            link.removeAttribute("aria-current");
          }
        });
      },
      {
        rootMargin: "-18% 0px -62% 0px",
        threshold: [0, 0.25, 0.5]
      }
    );

    storyCards.forEach(function (card) {
      observer.observe(card);
    });
  }

  let ticking = false;
  window.addEventListener(
    "scroll",
    function () {
      if (ticking) {
        return;
      }

      window.requestAnimationFrame(function () {
        updateScrollUi();
        ticking = false;
      });
      ticking = true;
    },
    { passive: true }
  );

  window.addEventListener("resize", updateScrollUi, { passive: true });
  updateScrollUi();
})();
