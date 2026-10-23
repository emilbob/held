<?php
/**
 * Plugin Name:       Held – Pay with Held button
 * Plugin URI:        https://getheld.xyz/#/faq/website
 * Description:       Add a "Pay with Held" button to any page: stablecoin payments with buyer protection. Shows your checkout link's live price. Use the "Pay with Held" block or the [held_button] shortcode.
 * Version:           1.0.0
 * Requires at least: 6.3
 * Requires PHP:      7.4
 * Author:            Held
 * Author URI:        https://getheld.xyz
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       held-pay-button
 *
 * The button itself is button.js (the same file getheld.xyz/button.js serves to Webflow and other sites), bundled here
 * so the plugin loads no code from another site. It fetches the link's public price from the site the link points to.
 */

if (!defined('ABSPATH')) exit;

define('HELD_PAY_BUTTON_VERSION', '1.0.0');

// "https://getheld.xyz/#/buy/Ab3xYz": the only kind of link the button accepts (button.js checks the same).
function held_pay_button_valid_link($link) {
	return (bool) preg_match('~^https://[^\s#]+#/buy/[A-Za-z0-9_-]+$~', $link);
}

/**
 * The button's markup, for the block and the shortcode alike. button.js turns the div into the live-price button; the
 * plain link inside is what visitors get without JavaScript (and what search engines see).
 */
function held_pay_button_html($a) {
	$link = trim((string) ($a['link'] ?? ''));
	if (!held_pay_button_valid_link($link)) {
		// Only editors see why nothing shows; visitors see nothing.
		return current_user_can('edit_posts')
			? '<p style="padding:8px 12px;border:1px dashed #c00;color:#c00;font-size:14px">' .
				esc_html__('Pay with Held: paste a checkout link from your Held dashboard (it looks like https://getheld.xyz/#/buy/Ab3xYz).', 'held-pay-button') . '</p>'
			: '';
	}
	wp_enqueue_script('held-pay-button');

	$data = ['data-held-link' => $link];
	if (!empty($a['label'])) $data['data-held-label'] = $a['label'];
	if (($a['theme'] ?? '') === 'light') $data['data-held-theme'] = 'light';
	if (!filter_var($a['tagline'] ?? true, FILTER_VALIDATE_BOOLEAN)) $data['data-held-tagline'] = 'false';
	if (!filter_var($a['newTab'] ?? true, FILTER_VALIDATE_BOOLEAN)) $data['data-held-target'] = '_self';
	if (isset($a['radius']) && is_numeric($a['radius']) && (float) $a['radius'] != 10) $data['data-held-radius'] = (string) (float) $a['radius'];
	$attrs = '';
	foreach ($data as $k => $v) $attrs .= ' ' . $k . '="' . ($k === 'data-held-link' ? esc_url($v) : esc_attr($v)) . '"';

	$align = in_array($a['align'] ?? '', ['left', 'center', 'right'], true) ? $a['align'] : '';
	$wrapper = function_exists('get_block_wrapper_attributes') && !empty($a['__block'])
		? get_block_wrapper_attributes($align ? ['style' => 'text-align:' . $align] : [])
		: 'class="held-pay-button"' . ($align ? ' style="text-align:' . $align . '"' : '');

	return '<div ' . $wrapper . '><div' . $attrs . '><a href="' . esc_url($link) . '"' .
		(empty($data['data-held-target']) ? ' target="_blank" rel="noopener"' : '') . '>' .
		esc_html($a['label'] ?: __('Pay with Held', 'held-pay-button')) . '</a></div></div>';
}

add_action('init', function () {
	wp_register_script('held-pay-button', plugins_url('button.js', __FILE__), [], HELD_PAY_BUTTON_VERSION, ['in_footer' => true, 'strategy' => 'async']);
	wp_register_script('held-pay-button-editor', plugins_url('block/editor.js', __FILE__),
		['wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components', 'wp-i18n'], HELD_PAY_BUTTON_VERSION, true);

	register_block_type(__DIR__ . '/block', [
		'render_callback' => function ($attributes) {
			return held_pay_button_html($attributes + ['__block' => true]);
		},
	]);

	// [held_button link="https://getheld.xyz/#/buy/Ab3xYz" label="Buy the poster" theme="light" tagline="false" newtab="false" radius="0" align="center"]
	add_shortcode('held_button', function ($atts) {
		$a = shortcode_atts(['link' => '', 'label' => '', 'theme' => 'dark', 'tagline' => 'true', 'newtab' => 'true', 'radius' => '10', 'align' => ''], $atts, 'held_button');
		$a['newTab'] = $a['newtab'];
		return held_pay_button_html($a);
	});
});
