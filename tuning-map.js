(() => {
  "use strict";
  const make = (second, third) => Object.freeze(Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => {
      const n = i + 1;
      return [n, Object.freeze([n, n + second, n + third])];
    })
  ));
  window.ShianTuningMap = Object.freeze({
    hon: make(5, 12),
    niage: make(7, 12),
    sansage: make(5, 10)
  });
  window.ShianStringOrder = Object.freeze(["ichi", "ni", "san"]);
})();
