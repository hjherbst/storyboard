<?php
/**
 * Frontend app rewrite and template.
 *
 * @package Storyboards
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Storyboards_Rewrite {

	public const QUERY_VAR       = 'storyboards_app';
	public const QUERY_VAR_BOARD = 'storyboards_board';
	public const REWRITE_VERSION = '2';

	/**
	 * Register hooks.
	 */
	public function register_hooks(): void {
		add_action( 'init', array( __CLASS__, 'register_rewrites' ) );
		add_action( 'init', array( __CLASS__, 'maybe_flush_rewrites' ), 20 );
		add_filter( 'query_vars', array( __CLASS__, 'query_vars' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_assets' ), 20 );
		add_action( 'template_redirect', array( __CLASS__, 'template_redirect' ) );
		add_action( 'admin_bar_menu', array( __CLASS__, 'admin_bar_link' ), 80 );
	}

	/**
	 * Whether the Storyboards app route is being viewed.
	 */
	public static function is_app(): bool {
		return (bool) get_query_var( self::QUERY_VAR );
	}

	/**
	 * Load app CSS on top of the active theme styles.
	 */
	public static function enqueue_assets(): void {
		if ( ! self::is_app() ) {
			return;
		}

		// Depend on global styles so theme.json presets/fonts load first.
		$deps = array();
		if ( wp_style_is( 'global-styles', 'registered' ) || wp_style_is( 'global-styles', 'enqueued' ) ) {
			$deps[] = 'global-styles';
		}

		wp_enqueue_style(
			'storyboards-app',
			STORYBOARDS_URL . 'assets/css/app.css',
			$deps,
			STORYBOARDS_VERSION
		);
	}

	/**
	 * Add rewrite rules for /storyboards/ and /storyboards/{slug}/.
	 */
	public static function register_rewrites(): void {
		add_rewrite_rule(
			'^storyboards/?$',
			'index.php?' . self::QUERY_VAR . '=1',
			'top'
		);
		add_rewrite_rule(
			'^storyboards/([^/]+)/?$',
			'index.php?' . self::QUERY_VAR . '=1&' . self::QUERY_VAR_BOARD . '=$matches[1]',
			'top'
		);
	}

	/**
	 * Flush rewrite rules once when the plugin rewrite version changes.
	 */
	public static function maybe_flush_rewrites(): void {
		$stored = (string) get_option( 'storyboards_rewrite_version', '' );
		if ( $stored === self::REWRITE_VERSION ) {
			return;
		}
		self::register_rewrites();
		flush_rewrite_rules( false );
		update_option( 'storyboards_rewrite_version', self::REWRITE_VERSION, false );
	}

	/**
	 * App base URL (/storyboards/).
	 */
	public static function app_url(): string {
		return trailingslashit( home_url( '/storyboards' ) );
	}

	/**
	 * Public URL for a board slug.
	 */
	public static function board_url( string $slug ): string {
		$slug = sanitize_title( $slug );
		if ( '' === $slug ) {
			return self::app_url();
		}
		return trailingslashit( self::app_url() . $slug );
	}

	/**
	 * Board slug from the current request, if any.
	 */
	public static function requested_board_slug(): string {
		$slug = (string) get_query_var( self::QUERY_VAR_BOARD );
		return sanitize_title( $slug );
	}

	/**
	 * Register query var.
	 *
	 * @param string[] $vars Query vars.
	 * @return string[]
	 */
	public static function query_vars( array $vars ): array {
		$vars[] = self::QUERY_VAR;
		$vars[] = self::QUERY_VAR_BOARD;
		return $vars;
	}

	/**
	 * Serve the app template or redirect unauthorized users.
	 */
	public static function template_redirect(): void {
		if ( ! get_query_var( self::QUERY_VAR ) ) {
			return;
		}

		if ( ! is_user_logged_in() ) {
			auth_redirect();
			exit;
		}

		if ( ! current_user_can( 'manage_storyboards' ) ) {
			wp_die(
				esc_html__( 'You do not have permission to manage storyboards.', 'storyboards' ),
				esc_html__( 'Forbidden', 'storyboards' ),
				array( 'response' => 403 )
			);
		}

		status_header( 200 );
		nocache_headers();
		header( 'X-Robots-Tag: noindex, nofollow', true );

		include STORYBOARDS_PATH . 'templates/app.php';
		exit;
	}

	/**
	 * Add Admin Bar link.
	 *
	 * @param WP_Admin_Bar $bar Admin bar.
	 */
	public static function admin_bar_link( WP_Admin_Bar $bar ): void {
		if ( ! current_user_can( 'manage_storyboards' ) ) {
			return;
		}

		$bar->add_node(
			array(
				'id'    => 'storyboards-app',
				'title' => __( 'Storyboards', 'storyboards' ),
				'href'  => home_url( '/storyboards/' ),
				'meta'  => array(
					'title' => __( 'Open Storyboards app', 'storyboards' ),
				),
			)
		);
	}
}
