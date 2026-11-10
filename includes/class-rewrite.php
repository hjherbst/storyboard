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

	public const QUERY_VAR = 'storyboards_app';

	/**
	 * Register hooks.
	 */
	public function register_hooks(): void {
		add_action( 'init', array( __CLASS__, 'register_rewrites' ) );
		add_filter( 'query_vars', array( __CLASS__, 'query_vars' ) );
		add_action( 'template_redirect', array( __CLASS__, 'template_redirect' ) );
		add_action( 'admin_bar_menu', array( __CLASS__, 'admin_bar_link' ), 80 );
	}

	/**
	 * Add rewrite rule for /storyboards/.
	 */
	public static function register_rewrites(): void {
		add_rewrite_rule( '^storyboards/?$', 'index.php?' . self::QUERY_VAR . '=1', 'top' );
	}

	/**
	 * Register query var.
	 *
	 * @param string[] $vars Query vars.
	 * @return string[]
	 */
	public static function query_vars( array $vars ): array {
		$vars[] = self::QUERY_VAR;
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
