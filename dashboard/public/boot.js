// Applies the saved theme colour, light or dark mode, and motion level before the first paint (no flash).
// Both pages load it. Keys: 'lab-theme' (colour), 'theme' (light | dark; none = system), 'lab-motion'.
(function () {
  var themes = { forest: [165, 1], ocean: [232, 1], plum: [318, 0.95], ember: [32, 1], graphite: [230, 0.12] };
  var root = document.documentElement;
  try {
    var t = themes[localStorage.getItem('lab-theme')] || themes.forest;
    root.style.setProperty('--h', t[0]);
    root.style.setProperty('--k', t[1]);
    var mode = localStorage.getItem('theme');
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    var m = localStorage.getItem('lab-motion');
    if (m === 'reduced' || m === 'off') root.setAttribute('data-motion', m);
  } catch (e) { /* storage blocked: defaults and the system setting */ }
})();
