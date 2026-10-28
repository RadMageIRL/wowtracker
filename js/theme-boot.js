// Applies the saved theme before first paint, so a light or system choice does not flash dark first.
(function () {
  var theme = 'dark';
  try {
    var p = JSON.parse(localStorage.getItem('wowtracker:v1:prefs') || '{}');
    if (p && (p.theme === 'light' || p.theme === 'system')) theme = p.theme;
  } catch (e) { /* storage blocked: keep dark */ }
  if (theme === 'system') theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
})();
