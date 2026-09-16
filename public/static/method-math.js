/**
 * Render homepage methodology formulas with KaTeX.
 * Host elements keep Unicode fallback if KaTeX is unavailable.
 */
(function renderMethodFormulas() {
  if (typeof katex === 'undefined') return;

  const formulas = {
    'formula-score': String.raw`\begin{aligned}
& \mathrm{Score}(i \rightarrow j, t, \mathrm{pref}) = \\
& w_1 \times \mathrm{norm}(\mathrm{PR}_{j}(t)) \\
& + w_2 \times \mathrm{norm}(\mathrm{transition}_{ij}(t)) \\
& + w_3 \times \mathrm{PreferenceMatch}(j, \mathrm{pref}) \\
& - w_4 \times \mathrm{norm}(\mathrm{TravelCost}(i, j))
\end{aligned}`,
    'formula-norm': String.raw`\mathrm{norm}(x) = \frac{x - x_{\min}}{x_{\max} - x_{\min}}`,
    'formula-pagerank': String.raw`p_{ij} = \gamma \times \left(\frac{e_{ij}}{s_i}\right) + (1 - \gamma) \times \left(\frac{1}{n}\right)`
  };

  Object.keys(formulas).forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    katex.render(formulas[id], el, {
      displayMode: true,
      throwOnError: false,
      fleqn: true,
      output: 'html'
    });
  });
})();
