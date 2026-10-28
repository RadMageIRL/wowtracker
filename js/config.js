// The addresses the footer and Share use. They live here so publishing means editing one file:
// nothing else in the code names a project address. A link set to null is left out of the footer.
(function (root) {
  'use strict';

  const Config = {
    /** The address Share passes along. null: the address the page was opened at. */
    shareUrl: null,
    links: {
      labs: 'https://radmagelabs.com/',
      /** The GitHub profile until the project has a public repository of its own. */
      github: 'https://github.com/RadMageIRL',
      /** Where feedback goes (for example the repository's Issues page). Not set until there is one. */
      feedback: null,
      coffee: 'https://buymeacoffee.com/radmageirl',
    },
  };

  if (typeof module === 'object' && module.exports) module.exports = Config;
  else root.WoWConfig = Config;
})(typeof globalThis !== 'undefined' ? globalThis : this);
