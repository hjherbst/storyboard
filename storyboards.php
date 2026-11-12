<?php
/**
 * Plugin Name:       Storyboards
 * Plugin URI:        https://strgl.de
 * Description:       Mobile-first storyboards for video production. Collect shots, scripts, and reference photos.
 * Version:           1.0.49
 * Requires at least: 6.0
 * Requires PHP:      8.0
 * Author:            STRGL
 * Author URI:        https://strgl.de
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       storyboards
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'STORYBOARDS_VERSION', '1.0.49' );
define( 'STORYBOARDS_FILE', __FILE__ );
define( 'STORYBOARDS_PATH', plugin_dir_path( __FILE__ ) );
define( 'STORYBOARDS_URL', plugin_dir_url( __FILE__ ) );
define( 'STORYBOARDS_DB_VERSION', '3' );

require_once STORYBOARDS_PATH . 'includes/class-activator.php';
require_once STORYBOARDS_PATH . 'includes/class-cpt.php';
require_once STORYBOARDS_PATH . 'includes/class-rest.php';
require_once STORYBOARDS_PATH . 'includes/class-rewrite.php';
require_once STORYBOARDS_PATH . 'includes/class-updater.php';
require_once STORYBOARDS_PATH . 'includes/class-plugin.php';

register_activation_hook( __FILE__, array( 'Storyboards_Activator', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'Storyboards_Activator', 'deactivate' ) );

add_action(
	'plugins_loaded',
	static function (): void {
		Storyboards_Updater::init();
		Storyboards_Plugin::instance()->init();
	}
);
