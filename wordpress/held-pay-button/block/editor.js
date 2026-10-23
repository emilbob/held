/* The "Pay with Held" block in the editor. Plain JS on WordPress's own globals, so the plugin needs no build step.
 * The preview is the real button: button.js (loaded into the editor too, through block.json "script") renders it with
 * the live price. The block is saved as attributes only and drawn on the server (held-pay-button.php).
 */
(function (blocks, element, blockEditor, components, i18n) {
  'use strict'
  var el = element.createElement
  var __ = i18n.__
  var LINK = /^https:\/\/[^\s#]+#\/buy\/[A-Za-z0-9_-]+$/

  function Edit(props) {
    var a = props.attributes
    var set = props.setAttributes
    var link = (a.link || '').trim()
    var valid = LINK.test(link)
    // The empty block's own field keeps what's typed until "Add button": saving each keystroke would turn the block into
    // the button as soon as the start of a link looked valid, and cut off the rest.
    var draftState = element.useState(link)
    var draft = draftState[0]
    var setDraft = draftState[1]
    var draftValid = LINK.test(draft.trim())

    // A preview: a click selects the block instead of opening the link (which would create an order).
    var data = { 'data-held-link': link, 'data-held-preview': 'true' }
    if (a.label) data['data-held-label'] = a.label
    if (a.theme === 'light') data['data-held-theme'] = 'light'
    if (!a.tagline) data['data-held-tagline'] = 'false'
    if (a.radius !== 10) data['data-held-radius'] = String(a.radius)
    // A new key gives button.js a fresh element to draw each time a setting changes.
    data.key = JSON.stringify([link, a.label, a.theme, a.tagline, a.radius])

    var linkField = el(components.TextControl, {
      label: __('Checkout link', 'held-pay-button'),
      help: __('Copy it from your Held dashboard: Checkout links → Copy link.', 'held-pay-button'),
      value: a.link,
      placeholder: 'https://getheld.xyz/#/buy/…',
      onChange: function (v) { set({ link: v.trim() }) },
      __nextHasNoMarginBottom: true,
    })

    var panel = el(blockEditor.InspectorControls, null,
      el(components.PanelBody, { title: __('Button', 'held-pay-button') },
        linkField,
        el(components.TextControl, {
          label: __('Label', 'held-pay-button'),
          help: __('Leave empty to show "Pay $20.00 with Held" with the live price.', 'held-pay-button'),
          value: a.label,
          onChange: function (v) { set({ label: v }) },
          __nextHasNoMarginBottom: true,
        }),
        el(components.SelectControl, {
          label: __('Theme', 'held-pay-button'),
          value: a.theme,
          options: [{ label: __('Dark', 'held-pay-button'), value: 'dark' }, { label: __('Light', 'held-pay-button'), value: 'light' }],
          onChange: function (v) { set({ theme: v }) },
          __nextHasNoMarginBottom: true,
        }),
        el(components.ToggleControl, {
          label: __('Show "buyer protected"', 'held-pay-button'),
          checked: a.tagline,
          onChange: function (v) { set({ tagline: v }) },
          __nextHasNoMarginBottom: true,
        }),
        el(components.ToggleControl, {
          label: __('Open in a new tab', 'held-pay-button'),
          checked: a.newTab,
          onChange: function (v) { set({ newTab: v }) },
          __nextHasNoMarginBottom: true,
        }),
        el(components.RangeControl, {
          label: __('Corner radius', 'held-pay-button'),
          value: a.radius,
          min: 0,
          max: 30,
          onChange: function (v) { set({ radius: typeof v === 'number' ? v : 10 }) },
          __nextHasNoMarginBottom: true,
        })
      )
    )
    var toolbar = el(blockEditor.BlockControls, null,
      el(blockEditor.AlignmentToolbar, { value: a.align, onChange: function (v) { set({ align: v || '' }) } }))

    var blockProps = blockEditor.useBlockProps({ style: a.align ? { textAlign: a.align } : undefined })
    var body = valid
      ? el('div', data)
      : el(components.Placeholder, {
          icon: 'money-alt',
          label: __('Pay with Held', 'held-pay-button'),
          instructions: draft.trim() && !draftValid
            ? __("That isn't a Held checkout link. It looks like https://getheld.xyz/#/buy/Ab3xYz.", 'held-pay-button')
            : __('Paste a checkout link from your Held dashboard (Checkout links → Copy link). The button shows its live price, and buyers pay with buyer protection.', 'held-pay-button'),
        }, el('form', {
          style: { display: 'flex', gap: '8px', width: '100%' },
          onSubmit: function (e) { e.preventDefault(); if (draftValid) set({ link: draft.trim() }) },
        },
          el('input', {
            type: 'url', className: 'components-placeholder__input', style: { flex: 1 },
            'aria-label': __('Checkout link', 'held-pay-button'), placeholder: 'https://getheld.xyz/#/buy/…',
            value: draft, onChange: function (e) { setDraft(e.target.value) },
          }),
          el(components.Button, { variant: 'primary', type: 'submit', disabled: !draftValid }, __('Add button', 'held-pay-button'))))

    return el('div', blockProps, toolbar, panel, body)
  }

  blocks.registerBlockType('held/pay-button', {
    edit: Edit,
    save: function () { return null },
    // Pasting a checkout link on its own line turns it into the button, like pasting a video link.
    transforms: {
      from: [{
        type: 'raw',
        isMatch: function (node) { return node.nodeName === 'P' && LINK.test(node.textContent.trim()) },
        transform: function (node) { return blocks.createBlock('held/pay-button', { link: node.textContent.trim() }) },
      }],
    },
  })
})(window.wp.blocks, window.wp.element, window.wp.blockEditor, window.wp.components, window.wp.i18n)
