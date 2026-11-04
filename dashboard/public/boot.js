// Applies the saved theme colour and motion level before the first paint (no flash).
(function () {
  var themes = { forest: [165, 1], ocean: [232, 1], plum: [318, 0.95], ember: [32, 1], graphite: [230, 0.12] };
  var root = document.documentElement;
  try {
    var t = themes[localStorage.getItem('lab-theme')] || themes.forest;
    root.style.setProperty('--h', t[0]);
    root.style.setProperty('--k', t[1]);
    var m = localStorage.getItem('lab-motion');
    if (m === 'reduced' || m === 'off') root.setAttribute('data-motion', m);
  } catch (e) { /* storage blocked: defaults */ }
})();
