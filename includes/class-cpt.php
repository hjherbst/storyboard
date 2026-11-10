<?php
/**
 * Custom post type registration.
 *
 * @package Storyboards
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Storyboards_CPT {

	public const POST_TYPE     = 'storyboard';
	public const META_ASPECT   = 'aspect_ratio';
	public const ASPECT_VALUES = array( '16:9', '9:16' );

	/**
	 * Register hooks.
	 */
	public function register_hooks(): void {
		add_action( 'init', array( __CLASS__, 'register' ) );
	}

	/**
	 * Register the storyboard post type.
	 */
	public static function register(): void {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels'              => array(
					'name'          => __( 'Storyboards', 'storyboards' ),
					'singular_name' => __( 'Storyboard', 'storyboards' ),
					'add_new_item'  => __( 'Add New Storyboard', 'storyboards' ),
					'edit_item'     => __( 'Edit Storyboard', 'storyboards' ),
				),
				'public'              => false,
				'show_ui'             => false,
				'show_in_menu'        => false,
				'show_in_rest'        => false,
				'exclude_from_search' => true,
				'publicly_queryable'  => false,
				'capability_type'     => 'post',
				'map_meta_cap'        => true,
				'supports'            => array( 'title', 'author' ),
				'has_archive'         => false,
				'rewrite'             => false,
			)
		);

		register_post_meta(
			self::POST_TYPE,
			self::META_ASPECT,
			array(
				'type'              => 'string',
				'single'            => true,
				'sanitize_callback' => array( __CLASS__, 'sanitize_aspect' ),
				'auth_callback'     => static function (): bool {
					return current_user_can( 'manage_storyboards' );
				},
				'show_in_rest'      => false,
				'default'           => '16:9',
			)
		);
	}

	/**
	 * Sanitize aspect ratio meta.
	 */
	public static function sanitize_aspect( mixed $value ): string {
		$value = is_string( $value ) ? $value : '16:9';
		return in_array( $value, self::ASPECT_VALUES, true ) ? $value : '16:9';
	}
}
