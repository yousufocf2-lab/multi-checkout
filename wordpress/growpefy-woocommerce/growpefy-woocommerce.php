<?php
/**
 * Plugin Name:       Growpefy Checkout for WooCommerce
 * Plugin URI:        https://growpefy.com
 * Description:       Sends your WooCommerce checkout to Growpefy: one-page checkout, COD OTP, prepaid and partial COD offers, up to 3 payment gateways. Orders come back into WooCommerce.
 * Version:           1.0.0
 * Author:            Growpefy
 * Author URI:        https://growpefy.com
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * WC requires at least: 7.0
 * WC tested up to:   9.9
 * License:           GPLv2 or later
 * Text Domain:       growpefy
 */

if (!defined('ABSPATH')) {
    exit;
}

define('GROWPEFY_WC_VERSION', '1.0.0');
define('GROWPEFY_WC_FILE', __FILE__);

// HPOS (custom order tables) and cart/checkout blocks are supported.
add_action('before_woocommerce_init', function () {
    if (class_exists('\Automattic\WooCommerce\Utilities\FeaturesUtil')) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', GROWPEFY_WC_FILE, true);
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('cart_checkout_blocks', GROWPEFY_WC_FILE, true);
    }
});

final class Growpefy_WC
{
    const NS = 'growpefy/v1';
    const MAX_SKEW = 300;

    public static function init()
    {
        add_action('rest_api_init', [__CLASS__, 'routes']);
        add_action('template_redirect', [__CLASS__, 'maybe_clear_cart'], 5);
        add_action('template_redirect', [__CLASS__, 'maybe_redirect'], 20);
        add_action('admin_menu', [__CLASS__, 'menu'], 60);
        add_action('admin_init', [__CLASS__, 'register_settings']);
        add_action('admin_notices', [__CLASS__, 'notice']);
        add_filter('plugin_action_links_' . plugin_basename(GROWPEFY_WC_FILE), [__CLASS__, 'links']);
    }

    // ------------------------------------------------------------------ settings

    public static function opt($key, $default = '')
    {
        $v = get_option('growpefy_' . $key, $default);
        return is_string($v) ? trim($v) : $v;
    }

    public static function app_url()
    {
        $u = untrailingslashit(self::opt('app_url', 'https://growpefy.com'));
        return $u ? $u : 'https://growpefy.com';
    }

    public static function configured()
    {
        return self::opt('store_id') !== '' && self::opt('secret') !== '';
    }

    public static function register_settings()
    {
        $text = ['type' => 'string', 'sanitize_callback' => 'sanitize_text_field'];
        register_setting('growpefy', 'growpefy_app_url', ['type' => 'string', 'sanitize_callback' => 'esc_url_raw', 'default' => 'https://growpefy.com']);
        register_setting('growpefy', 'growpefy_store_id', $text);
        register_setting('growpefy', 'growpefy_secret', $text);
        register_setting('growpefy', 'growpefy_enabled', $text);
        register_setting('growpefy', 'growpefy_admin_only', $text);
    }

    public static function menu()
    {
        add_submenu_page('woocommerce', 'Growpefy Checkout', 'Growpefy', 'manage_woocommerce', 'growpefy', [__CLASS__, 'page']);
    }

    public static function links($links)
    {
        array_unshift($links, '<a href="' . esc_url(admin_url('admin.php?page=growpefy')) . '">Settings</a>');
        return $links;
    }

    public static function notice()
    {
        if (!current_user_can('manage_woocommerce') || self::configured()) {
            return;
        }
        if (!class_exists('WooCommerce')) {
            echo '<div class="notice notice-error"><p><b>Growpefy Checkout</b> needs WooCommerce to be installed and active.</p></div>';
            return;
        }
        echo '<div class="notice notice-warning"><p><b>Growpefy Checkout:</b> paste your Store ID and secret key in <a href="' . esc_url(admin_url('admin.php?page=growpefy')) . '">WooCommerce → Growpefy</a>.</p></div>';
    }

    public static function page()
    {
        if (!current_user_can('manage_woocommerce')) {
            return;
        }
        $secret = self::opt('secret'); ?>
        <div class="wrap">
            <h1>Growpefy Checkout</h1>
            <p>Copy these from your Growpefy dashboard: <b>Store → Setup</b>.</p>
            <form method="post" action="options.php">
                <?php settings_fields('growpefy'); ?>
                <table class="form-table" role="presentation">
                    <tr><th scope="row"><label for="growpefy_app_url">Growpefy URL</label></th>
                        <td><input name="growpefy_app_url" id="growpefy_app_url" type="url" class="regular-text" value="<?php echo esc_attr(self::app_url()); ?>"></td></tr>
                    <tr><th scope="row"><label for="growpefy_store_id">Store ID</label></th>
                        <td><input name="growpefy_store_id" id="growpefy_store_id" type="text" class="regular-text" value="<?php echo esc_attr(self::opt('store_id')); ?>" autocomplete="off"></td></tr>
                    <tr><th scope="row"><label for="growpefy_secret">Secret key</label></th>
                        <td><input name="growpefy_secret" id="growpefy_secret" type="password" class="regular-text" value="<?php echo esc_attr($secret); ?>" autocomplete="new-password">
                            <p class="description">Keep it private. It signs every request between your store and Growpefy.</p></td></tr>
                    <tr><th scope="row">Checkout</th>
                        <td>
                            <label><input name="growpefy_enabled" type="checkbox" value="yes" <?php checked(self::opt('enabled', 'yes'), 'yes'); ?>> Send the checkout to Growpefy</label><br>
                            <label><input name="growpefy_admin_only" type="checkbox" value="yes" <?php checked(self::opt('admin_only', 'yes'), 'yes'); ?>> Only for logged-in admins (test mode)</label>
                            <p class="description">Test with an order first, then untick "Only for logged-in admins" so every customer gets the Growpefy checkout. If Growpefy can't be reached, customers see your normal WooCommerce checkout.</p>
                        </td></tr>
                </table>
                <?php submit_button(); ?>
            </form>
            <p style="color:#666">Plugin version <?php echo esc_html(GROWPEFY_WC_VERSION); ?>. Status: <?php echo self::configured() ? '<b style="color:#0B5D4B">Configured</b>' : '<b style="color:#b45309">Not configured</b>'; ?>.
                Test the connection from your Growpefy dashboard (Setup → Test connection).</p>
        </div>
        <?php
    }

    // ------------------------------------------------------------------ signing

    public static function sign($time, $body)
    {
        return hash_hmac('sha256', $time . '.' . $body, self::opt('secret'));
    }

    /** permission_callback: every Growpefy → store request carries a fresh signature. */
    public static function verify(WP_REST_Request $req)
    {
        if (!self::configured()) {
            return new WP_Error('growpefy_not_configured', 'Growpefy Store ID / secret key are not saved in the plugin.', ['status' => 503]);
        }
        $time = (string) $req->get_header('x_growpefy_time');
        $sig = strtolower((string) $req->get_header('x_growpefy_signature'));
        if (!preg_match('/^\d{9,11}$/', $time) || !preg_match('/^[a-f0-9]{64}$/', $sig) || abs(time() - (int) $time) > self::MAX_SKEW) {
            return new WP_Error('growpefy_bad_signature', 'Missing or expired signature.', ['status' => 401]);
        }
        if (!hash_equals(self::sign($time, $req->get_body()), $sig)) {
            return new WP_Error('growpefy_bad_signature', 'Signature does not match. Check the secret key.', ['status' => 401]);
        }
        return true;
    }

    /** Signed request to Growpefy. */
    public static function post($path, array $payload, $timeout = 8)
    {
        $body = wp_json_encode($payload);
        $time = (string) time();
        return wp_remote_post(self::app_url() . $path, [
            'timeout' => $timeout,
            'headers' => [
                'Content-Type' => 'application/json',
                'X-Growpefy-Time' => $time,
                'X-Growpefy-Signature' => self::sign($time, $body),
            ],
            'body' => $body,
        ]);
    }

    // ------------------------------------------------------------------ REST API (called by Growpefy)

    public static function routes()
    {
        $map = [
            'ping' => 'r_ping',
            'lines' => 'r_lines',
            'products' => 'r_products',
            'skus' => 'r_skus',
            'order/create' => 'r_order_create',
            'order/tag' => 'r_order_tag',
            'order/cancel' => 'r_order_cancel',
            'order/fulfil' => 'r_order_fulfil',
            'order/tracking' => 'r_order_tracking',
        ];
        foreach ($map as $path => $cb) {
            register_rest_route(self::NS, '/' . $path, [
                'methods' => 'POST',
                'callback' => [__CLASS__, $cb],
                'permission_callback' => [__CLASS__, 'verify'],
            ]);
        }
    }

    private static function body(WP_REST_Request $req)
    {
        $b = json_decode($req->get_body(), true);
        return is_array($b) ? $b : [];
    }

    private static function ids($v, $max = 100)
    {
        $out = [];
        foreach ((array) $v as $id) {
            $n = absint(preg_replace('/\D/', '', (string) $id));
            if ($n) {
                $out[] = $n;
            }
        }
        return array_slice(array_values(array_unique($out)), 0, $max);
    }

    private static function money($v)
    {
        return wc_format_decimal((string) $v, 2);
    }

    private static function image($product, $parent = null)
    {
        $id = $product->get_image_id();
        if (!$id && $parent) {
            $id = $parent->get_image_id();
        }
        $url = $id ? wp_get_attachment_image_url($id, 'woocommerce_thumbnail') : '';
        return $url ? $url : null;
    }

    public static function r_ping()
    {
        return [
            'ok' => true,
            'name' => get_bloginfo('name'),
            'currency' => get_woocommerce_currency(),
            'wc' => defined('WC_VERSION') ? WC_VERSION : '',
            'plugin' => GROWPEFY_WC_VERSION,
        ];
    }

    /** Live price + stock for products / variations. */
    public static function r_lines(WP_REST_Request $req)
    {
        $out = [];
        foreach (self::ids(self::body($req)['ids'] ?? []) as $id) {
            $p = wc_get_product($id);
            if (!$p || $p->get_status() === 'trash') {
                continue;
            }
            $parent = $p->is_type('variation') ? wc_get_product($p->get_parent_id()) : null;
            $out[] = [
                'id' => (string) $id,
                'product_id' => (string) ($parent ? $parent->get_id() : $p->get_id()),
                'title' => $parent ? $parent->get_name() : $p->get_name(),
                'variant_title' => $parent ? wc_get_formatted_variation($p, true, false, false) : null,
                'image' => self::image($p, $parent),
                'price' => (string) $p->get_price(),
                'regular_price' => (string) $p->get_regular_price(),
                'available' => !$p->is_type('variable') && !$p->is_type('grouped') && $p->is_purchasable() && $p->is_in_stock() && $p->get_price() !== '',
            ];
        }
        return ['items' => $out];
    }

    private static function catalog($p)
    {
        $variants = [];
        if ($p->is_type('variable')) {
            foreach ($p->get_children() as $vid) {
                $v = wc_get_product($vid);
                if (!$v) {
                    continue;
                }
                $variants[] = [
                    'id' => (string) $vid,
                    'title' => wc_get_formatted_variation($v, true, false, false),
                    'price' => (string) $v->get_price(),
                    'regular_price' => (string) $v->get_regular_price(),
                    'available' => $v->is_purchasable() && $v->is_in_stock() && $v->get_price() !== '',
                ];
                if (count($variants) >= 20) {
                    break;
                }
            }
        } elseif (!$p->is_type('grouped') && !$p->is_type('external')) {
            $variants[] = [
                'id' => (string) $p->get_id(),
                'title' => '',
                'price' => (string) $p->get_price(),
                'regular_price' => (string) $p->get_regular_price(),
                'available' => $p->is_purchasable() && $p->is_in_stock() && $p->get_price() !== '',
            ];
        }
        return ['id' => (string) $p->get_id(), 'title' => $p->get_name(), 'image' => self::image($p), 'variants' => $variants];
    }

    /** Product search (dashboard picker), chosen ids (upsell) or newest products. */
    public static function r_products(WP_REST_Request $req)
    {
        $b = self::body($req);
        $args = ['post_type' => 'product', 'post_status' => 'publish', 'fields' => 'ids', 'no_found_rows' => true];
        if (!empty($b['ids'])) {
            $args['post__in'] = self::ids($b['ids'], 50);
            $args['posts_per_page'] = count($args['post__in']);
            $args['orderby'] = 'post__in';
        } elseif (!empty($b['newest'])) {
            $args['posts_per_page'] = min(30, absint($b['newest']));
            $args['orderby'] = 'date';
            $args['order'] = 'DESC';
        } else {
            $args['posts_per_page'] = min(50, max(1, absint($b['limit'] ?? 20)));
            $args['orderby'] = 'title';
            $args['order'] = 'ASC';
            $q = sanitize_text_field((string) ($b['q'] ?? ''));
            if ($q !== '') {
                $args['s'] = $q;
            }
        }
        if (isset($args['post__in']) && !$args['post__in']) {
            return ['products' => []];
        }
        $out = [];
        foreach (get_posts($args) as $pid) {
            $p = wc_get_product($pid);
            if ($p) {
                $out[] = self::catalog($p);
            }
        }
        return ['products' => $out];
    }

    public static function r_skus(WP_REST_Request $req)
    {
        $out = [];
        foreach (self::ids(self::body($req)['ids'] ?? []) as $id) {
            $p = wc_get_product($id);
            if ($p) {
                $out[(string) $id] = (string) $p->get_sku();
            }
        }
        return ['skus' => (object) $out];
    }

    private static function find_order($growpefy_id)
    {
        $ids = wc_get_orders([
            'limit' => 1,
            'return' => 'ids',
            'status' => 'any',
            'meta_query' => [['key' => '_growpefy_order_id', 'value' => $growpefy_id]],
        ]);
        return $ids ? wc_get_order($ids[0]) : null;
    }

    /** Creates the WooCommerce order for a Growpefy order. Same growpefy_id twice returns the first order. */
    public static function r_order_create(WP_REST_Request $req)
    {
        $b = self::body($req);
        $gid = sanitize_text_field((string) ($b['growpefy_id'] ?? ''));
        if ($gid === '' || empty($b['items']) || !is_array($b['items'])) {
            return new WP_Error('growpefy_bad_order', 'Order id and items are required.', ['status' => 400]);
        }
        $existing = self::find_order($gid);
        if ($existing) {
            return ['id' => $existing->get_id(), 'number' => (string) $existing->get_order_number(), 'existed' => true];
        }

        // check every product first so a bad line never leaves a half-made order
        $lines = [];
        foreach ($b['items'] as $it) {
            $p = wc_get_product(absint($it['id'] ?? 0));
            if (!$p) {
                return new WP_Error('growpefy_product_missing', 'Product ' . absint($it['id'] ?? 0) . ' no longer exists in WooCommerce.', ['status' => 409]);
            }
            $lines[] = [$p, max(1, absint($it['quantity'] ?? 1)), (float) ($it['price'] ?? 0), !empty($it['free']), sanitize_text_field((string) ($it['offer'] ?? ''))];
        }

        $order = wc_create_order(['status' => 'pending', 'created_via' => 'growpefy']);
        if (is_wp_error($order)) {
            return $order;
        }
        foreach ($lines as $l) {
            list($p, $qty, $price, $free, $offer) = $l;
            $item_id = $order->add_product($p, $qty, ['subtotal' => $price * $qty, 'total' => $price * $qty]);
            if ($free && $item_id) {
                wc_add_order_item_meta($item_id, 'Free gift', $offer ? $offer : 'Offer');
            }
        }
        foreach ((array) ($b['discounts'] ?? []) as $d) {
            $amt = abs((float) ($d['amount'] ?? 0));
            if ($amt <= 0) {
                continue;
            }
            $fee = new WC_Order_Item_Fee();
            $fee->set_name(sanitize_text_field((string) ($d['label'] ?? 'Discount')));
            $fee->set_amount(-$amt);
            $fee->set_total(-$amt);
            $fee->set_tax_status('none');
            $order->add_item($fee);
        }
        foreach ((array) ($b['fees'] ?? []) as $f) {
            $amt = abs((float) ($f['amount'] ?? 0));
            if ($amt <= 0) {
                continue;
            }
            $fee = new WC_Order_Item_Fee();
            $fee->set_name(sanitize_text_field((string) ($f['label'] ?? 'Fee')));
            $fee->set_amount($amt);
            $fee->set_total($amt);
            $fee->set_tax_status('none');
            $order->add_item($fee);
        }
        $ship = new WC_Order_Item_Shipping();
        $ship->set_method_title(sanitize_text_field((string) ($b['shipping']['title'] ?? 'Standard delivery')));
        $ship->set_method_id('growpefy');
        $ship->set_total((float) ($b['shipping']['amount'] ?? 0));
        $order->add_item($ship);

        $c = (array) ($b['customer'] ?? []);
        $addr = [
            'first_name' => sanitize_text_field((string) ($c['first_name'] ?? '')),
            'last_name' => sanitize_text_field((string) ($c['last_name'] ?? '')),
            'address_1' => sanitize_text_field((string) ($c['address_1'] ?? '')),
            'address_2' => sanitize_text_field((string) ($c['address_2'] ?? '')),
            'city' => sanitize_text_field((string) ($c['city'] ?? '')),
            'state' => strtoupper(sanitize_text_field((string) ($c['state'] ?? ''))),
            'postcode' => sanitize_text_field((string) ($c['postcode'] ?? '')),
            'country' => 'IN',
            'phone' => '+91' . preg_replace('/\D/', '', (string) ($c['phone'] ?? '')),
        ];
        $email = sanitize_email((string) ($c['email'] ?? ''));
        $order->set_address($addr + ['email' => $email], 'billing');
        $order->set_address($addr, 'shipping');
        if ($email) {
            $user = get_user_by('email', $email);
            if ($user) {
                $order->set_customer_id($user->ID);
            }
        }

        $payment = (string) ($b['payment'] ?? 'prepaid');
        $order->set_payment_method($payment === 'cod' ? 'cod' : ($payment === 'partial' ? 'growpefy_partial' : 'growpefy'));
        $order->set_payment_method_title(sanitize_text_field((string) ($b['payment_title'] ?? 'Growpefy')));
        if (!empty($b['transaction_id'])) {
            $order->set_transaction_id(sanitize_text_field((string) $b['transaction_id']));
        }
        $order->update_meta_data('_growpefy_order_id', $gid);
        $order->update_meta_data('_growpefy_paid', self::money($b['paid'] ?? 0));
        $order->update_meta_data('_growpefy_collect', self::money($b['collect_on_delivery'] ?? 0));
        $order->update_meta_data('_growpefy_tags', array_values(array_filter(array_map('sanitize_text_field', (array) ($b['tags'] ?? [])))));

        $order->calculate_totals(false);
        if (isset($b['total'])) {
            $order->set_total(self::money($b['total'])); // exactly what Growpefy charged / will collect
        }
        $order->save();
        if (!empty($b['note'])) {
            $order->add_order_note(sanitize_textarea_field((string) $b['note']));
        }
        // Stock is reduced by WooCommerce when the order moves to processing / payment completes.
        if ($payment === 'prepaid') {
            $order->payment_complete(!empty($b['transaction_id']) ? sanitize_text_field((string) $b['transaction_id']) : '');
        } else {
            $order->update_status('processing', $payment === 'cod' ? 'Cash on delivery order from Growpefy checkout.' : 'Partial COD order from Growpefy checkout.');
        }
        return ['id' => $order->get_id(), 'number' => (string) $order->get_order_number()];
    }

    private static function order_or_error($b)
    {
        $o = wc_get_order(absint($b['id'] ?? 0));
        return $o ? $o : new WP_Error('growpefy_no_order', 'Order not found in WooCommerce.', ['status' => 404]);
    }

    public static function r_order_tag(WP_REST_Request $req)
    {
        $b = self::body($req);
        $o = self::order_or_error($b);
        if (is_wp_error($o)) {
            return $o;
        }
        $tags = array_values(array_filter(array_map('sanitize_text_field', (array) ($b['tags'] ?? []))));
        $old = (array) $o->get_meta('_growpefy_tags');
        $o->update_meta_data('_growpefy_tags', array_values(array_unique(array_merge($old, $tags))));
        $o->save();
        if ($tags) {
            $o->add_order_note('Growpefy: ' . implode(', ', $tags));
        }
        return ['ok' => true];
    }

    public static function r_order_cancel(WP_REST_Request $req)
    {
        $b = self::body($req);
        $o = self::order_or_error($b);
        if (is_wp_error($o)) {
            return $o;
        }
        if (!$o->has_status('cancelled')) {
            $o->update_status('cancelled', sanitize_text_field((string) ($b['note'] ?? 'Cancelled from Growpefy.'))); // stock goes back
        }
        return ['ok' => true];
    }

    public static function r_order_fulfil(WP_REST_Request $req)
    {
        $b = self::body($req);
        $o = self::order_or_error($b);
        if (is_wp_error($o)) {
            return $o;
        }
        if ($o->has_status(['cancelled', 'refunded', 'failed'])) {
            return ['ok' => false, 'cancelled' => true, 'error' => 'Order is ' . $o->get_status() . ' in WooCommerce'];
        }
        $number = sanitize_text_field((string) ($b['number'] ?? ''));
        $company = sanitize_text_field((string) ($b['company'] ?? ''));
        if ($o->has_status('completed') && $o->get_meta('_growpefy_awb') === $number) {
            return ['ok' => true, 'already' => true];
        }
        $o->update_meta_data('_growpefy_awb', $number);
        $o->update_meta_data('_growpefy_courier', $company);
        $o->save();
        if (function_exists('wc_st_add_tracking_number')) {
            wc_st_add_tracking_number($o->get_id(), $number, $company);
        }
        $o->update_status('completed', 'Shipped via ' . $company . ', AWB ' . $number . ' (Growpefy).');
        return ['ok' => true, 'already' => false];
    }

    /** AWB numbers saved by Growpefy, Shipment Tracking / AST, and common courier plugins. */
    private static function tracking_of($o)
    {
        $out = [];
        $add = function ($number, $company = null, $url = null) use (&$out) {
            $number = trim((string) $number);
            if ($number === '') {
                return;
            }
            foreach ($out as $t) {
                if ($t['number'] === $number) {
                    return;
                }
            }
            $out[] = ['number' => $number, 'company' => $company ? (string) $company : null, 'url' => $url ? (string) $url : null];
        };
        $add($o->get_meta('_growpefy_awb'), $o->get_meta('_growpefy_courier'));
        $items = $o->get_meta('_wc_shipment_tracking_items');
        if (is_array($items)) {
            foreach ($items as $t) {
                $add($t['tracking_number'] ?? '', ($t['custom_tracking_provider'] ?? '') ?: ($t['tracking_provider'] ?? ''), $t['custom_tracking_link'] ?? null);
            }
        }
        $keys = ['_tracking_number' => '_tracking_provider', 'tracking_number' => 'tracking_provider', '_aftership_tracking_number' => '_aftership_tracking_provider',
            'awb_number' => 'courier_name', '_awb_number' => '_courier_name', '_shiprocket_awb_code' => '_shiprocket_courier_name', 'shiprocket_awb' => 'shiprocket_courier', 'delhivery_waybill' => null, '_delhivery_waybill' => null];
        foreach ($keys as $k => $provider) {
            $v = $o->get_meta($k);
            if ($v) {
                $add($v, $provider ? $o->get_meta($provider) : null);
            }
        }
        return $out;
    }

    public static function r_order_tracking(WP_REST_Request $req)
    {
        $out = [];
        foreach (self::ids(self::body($req)['ids'] ?? [], 50) as $id) {
            $o = wc_get_order($id);
            if (!$o) {
                continue;
            }
            $m = $o->get_date_modified();
            $out[] = [
                'id' => (string) $id,
                'status' => $o->get_status(),
                'cancelled' => $o->has_status(['cancelled', 'refunded', 'failed']),
                'tags' => array_values((array) $o->get_meta('_growpefy_tags')),
                'updated' => $m ? $m->date('c') : null,
                'tracking' => self::tracking_of($o),
            ];
        }
        return ['orders' => $out];
    }

    // ------------------------------------------------------------------ storefront

    private static function live_for_visitor()
    {
        if (!self::configured() || self::opt('enabled', 'yes') !== 'yes') {
            return false;
        }
        if (self::opt('admin_only', 'yes') === 'yes' && !current_user_can('manage_woocommerce')) {
            return false;
        }
        return true;
    }

    private static function cookie($name)
    {
        return isset($_COOKIE[$name]) ? substr(sanitize_text_field(wp_unslash($_COOKIE[$name])), 0, 200) : null;
    }

    /** Google's _gcl_aw cookie looks like GCL.<time>.<gclid>. */
    private static function gclid()
    {
        $c = self::cookie('_gcl_aw');
        if ($c && preg_match('/^GCL\.\d+\.([\w-]{10,200})$/', $c, $m)) {
            return $m[1];
        }
        return null;
    }

    /** Checkout page → Growpefy. Any problem: the normal WooCommerce checkout shows instead. */
    public static function maybe_redirect()
    {
        if (!function_exists('is_checkout') || !is_checkout() || is_wc_endpoint_url('order-received') || is_wc_endpoint_url('order-pay')) {
            return;
        }
        if (isset($_GET['growpefy_skip']) || !self::live_for_visitor() || !WC()->cart || WC()->cart->is_empty()) {
            return;
        }
        $items = [];
        foreach (WC()->cart->get_cart() as $ci) {
            $id = !empty($ci['variation_id']) ? $ci['variation_id'] : $ci['product_id'];
            $items[] = ['variantId' => (string) $id, 'quantity' => (int) $ci['quantity']];
        }
        $ip = class_exists('WC_Geolocation') ? WC_Geolocation::get_ip_address() : (isset($_SERVER['REMOTE_ADDR']) ? sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR'])) : '');
        $res = self::post('/api/session', [
            'store' => self::opt('store_id'),
            'items' => $items,
            'url' => wp_get_referer() ? wp_get_referer() : home_url('/'),
            'fbp' => self::cookie('_fbp'),
            'fbc' => self::cookie('_fbc'),
            'gclid' => self::gclid(),
            'ip' => $ip,
            'ua' => isset($_SERVER['HTTP_USER_AGENT']) ? substr(sanitize_text_field(wp_unslash($_SERVER['HTTP_USER_AGENT'])), 0, 500) : '',
        ]);
        if (is_wp_error($res) || (int) wp_remote_retrieve_response_code($res) !== 200) {
            if (function_exists('wc_get_logger')) {
                wc_get_logger()->warning('Growpefy session failed: ' . (is_wp_error($res) ? $res->get_error_message() : wp_remote_retrieve_response_code($res) . ' ' . substr(wp_remote_retrieve_body($res), 0, 200)), ['source' => 'growpefy']);
            }
            return;
        }
        $data = json_decode(wp_remote_retrieve_body($res), true);
        if (empty($data['url']) || !preg_match('#^https?://#', $data['url'])) {
            return;
        }
        if (!empty($data['id']) && WC()->session) {
            WC()->session->set('growpefy_sid', sanitize_text_field($data['id']));
        }
        nocache_headers();
        wp_redirect(esc_url_raw($data['url']), 302, 'Growpefy');
        exit;
    }

    /** Empties the cart after a Growpefy order (?cx_clear=1 from the thank-you page, or a quick status check). */
    public static function maybe_clear_cart()
    {
        if (is_admin() || !function_exists('WC') || !WC()->session || !WC()->cart) {
            return;
        }
        if (isset($_GET['cx_clear'])) {
            WC()->cart->empty_cart();
            WC()->session->__unset('growpefy_sid');
            return;
        }
        $sid = WC()->session->get('growpefy_sid');
        if (!$sid || WC()->cart->is_empty()) {
            return;
        }
        $last = (int) WC()->session->get('growpefy_checked');
        if (time() - $last < 20) {
            return;
        }
        WC()->session->set('growpefy_checked', time());
        $res = wp_remote_get(add_query_arg(['store' => self::opt('store_id'), 'sid' => $sid], self::app_url() . '/api/woo/status'), ['timeout' => 3]);
        if (is_wp_error($res)) {
            return;
        }
        $data = json_decode(wp_remote_retrieve_body($res), true);
        if (!empty($data['done'])) {
            WC()->cart->empty_cart();
            WC()->session->__unset('growpefy_sid');
        }
    }
}

Growpefy_WC::init();
