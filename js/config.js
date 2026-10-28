// The addresses the footer and Share use. They live here so publishing means editing one file:
// nothing else in the code names a project address. A link set to null is left out of the footer.
(function (root) {
  'use strict';

  const Config = {
    /** The address Share passes along (the canonical one). null: the address the page was opened at. */
    shareUrl: 'https://radmagelabs.com/wow/',
    links: {
      labs: 'https://radmagelabs.com/',
      github: 'https://github.com/RadMageIRL/wowtracker',
      /** Where feedback goes: the repository's Issues page. */
      feedback: 'https://github.com/RadMageIRL/wowtracker/issues',
      coffee: 'https://buymeacoffee.com/radmageirl',
    },
  };

  if (typeof module === 'object' && module.exports) module.exports = Config;
  else root.WoWConfig = Config;
})(typeof globalThis !== 'undefined' ? globalThis : this);
