<?php
/**
 * REST API endpoints.
 *
 * @package Storyboards
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Storyboards_REST {

	public const NAMESPACE = 'storyboards/v1';

	/** Hard server-side upload limit (bytes). Client targets 70KB. */
	private const MAX_IMAGE_BYTES = 102400;

	/**
	 * Register hooks.
	 */
	public function register_hooks(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Register all routes.
	 */
	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/boards',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'list_boards' ),
					'permission_callback' => array( $this, 'can_manage' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_board' ),
					'permission_callback' => array( $this, 'can_manage' ),
					'args'                => array(
						'title'        => array(
							'required'          => true,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'aspect_ratio' => array(
							'required'          => false,
							'type'              => 'string',
							'default'           => '16:9',
							'sanitize_callback' => array( 'Storyboards_CPT', 'sanitize_aspect' ),
						),
					),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/boards/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_board' ),
					'permission_callback' => array( $this, 'can_manage' ),
				),
				array(
					'methods'             => 'PATCH',
					'callback'            => array( $this, 'update_board' ),
					'permission_callback' => array( $this, 'can_manage' ),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_board' ),
					'permission_callback' => array( $this, 'can_manage' ),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/boards/(?P<id>\d+)/scenes',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'list_scenes' ),
					'permission_callback' => array( $this, 'can_manage' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_scene' ),
					'permission_callback' => array( $this, 'can_manage' ),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/boards/(?P<id>\d+)/scenes/reorder',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'reorder_scenes' ),
				'permission_callback' => array( $this, 'can_manage' ),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/scenes/(?P<id>\d+)',
			array(
				array(
					'methods'             => 'PATCH',
					'callback'            => array( $this, 'update_scene' ),
					'permission_callback' => array( $this, 'can_manage' ),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_scene' ),
					'permission_callback' => array( $this, 'can_manage' ),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/scenes/(?P<id>\d+)/image',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'upload_scene_image' ),
				'permission_callback' => array( $this, 'can_manage' ),
			)
		);
	}

	/**
	 * Permission check.
	 */
	public function can_manage(): bool {
		return current_user_can( 'manage_storyboards' );
	}

	/**
	 * GET /boards
	 */
	public function list_boards(): WP_REST_Response {
		$posts = get_posts(
			array(
				'post_type'      => Storyboards_CPT::POST_TYPE,
				'post_status'    => array( 'publish', 'private' ),
				'posts_per_page' => 200,
				'orderby'        => 'modified',
				'order'          => 'DESC',
			)
		);

		$data = array_map( array( $this, 'format_board' ), $posts );
		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * POST /boards
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function create_board( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$title  = trim( (string) $request->get_param( 'title' ) );
		$aspect = Storyboards_CPT::sanitize_aspect( $request->get_param( 'aspect_ratio' ) );

		if ( '' === $title ) {
			return new WP_Error( 'storyboards_empty_title', __( 'Title is required.', 'storyboards' ), array( 'status' => 400 ) );
		}

		$post_id = wp_insert_post(
			array(
				'post_type'   => Storyboards_CPT::POST_TYPE,
				'post_title'  => $title,
				'post_status' => 'private',
				'post_author' => get_current_user_id(),
			),
			true
		);

		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		update_post_meta( $post_id, Storyboards_CPT::META_ASPECT, $aspect );

		$post = get_post( $post_id );
		return new WP_REST_Response( $this->format_board( $post ), 201 );
	}

	/**
	 * GET /boards/{id}
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function get_board( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$board = $this->get_board_post( (int) $request['id'] );
		if ( is_wp_error( $board ) ) {
			return $board;
		}

		$data             = $this->format_board( $board );
		$data['scenes']   = $this->get_scenes_for_board( (int) $board->ID );
		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * PATCH /boards/{id}
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function update_board( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$board = $this->get_board_post( (int) $request['id'] );
		if ( is_wp_error( $board ) ) {
			return $board;
		}

		$update = array( 'ID' => (int) $board->ID );
		$body   = $request->get_json_params();
		if ( ! is_array( $body ) ) {
			$body = array();
		}

		if ( isset( $body['title'] ) ) {
			$title = sanitize_text_field( (string) $body['title'] );
			if ( '' === $title ) {
				return new WP_Error( 'storyboards_empty_title', __( 'Title is required.', 'storyboards' ), array( 'status' => 400 ) );
			}
			$update['post_title'] = $title;
		}

		$result = wp_update_post( $update, true );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		if ( isset( $body['aspect_ratio'] ) ) {
			update_post_meta( (int) $board->ID, Storyboards_CPT::META_ASPECT, Storyboards_CPT::sanitize_aspect( $body['aspect_ratio'] ) );
		}

		$post = get_post( (int) $board->ID );
		return new WP_REST_Response( $this->format_board( $post ), 200 );
	}

	/**
	 * DELETE /boards/{id}
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function delete_board( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		global $wpdb;

		$board = $this->get_board_post( (int) $request['id'] );
		if ( is_wp_error( $board ) ) {
			return $board;
		}

		$board_id = (int) $board->ID;
		$table    = Storyboards_Activator::scenes_table();
		$scenes   = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->prepare( "SELECT id, image_id FROM {$table} WHERE storyboard_id = %d", $board_id )
		);

		foreach ( (array) $scenes as $scene ) {
			if ( ! empty( $scene->image_id ) ) {
				wp_delete_attachment( (int) $scene->image_id, true );
			}
		}

		$wpdb->delete( $table, array( 'storyboard_id' => $board_id ), array( '%d' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

		$deleted = wp_delete_post( $board_id, true );
		if ( ! $deleted ) {
			return new WP_Error( 'storyboards_delete_failed', __( 'Could not delete storyboard.', 'storyboards' ), array( 'status' => 500 ) );
		}

		return new WP_REST_Response( array( 'deleted' => true, 'id' => $board_id ), 200 );
	}

	/**
	 * GET /boards/{id}/scenes
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function list_scenes( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$board = $this->get_board_post( (int) $request['id'] );
		if ( is_wp_error( $board ) ) {
			return $board;
		}

		return new WP_REST_Response( $this->get_scenes_for_board( (int) $board->ID ), 200 );
	}

	/**
	 * POST /boards/{id}/scenes
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function create_scene( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		global $wpdb;

		$board = $this->get_board_post( (int) $request['id'] );
		if ( is_wp_error( $board ) ) {
			return $board;
		}

		$body = $request->get_json_params();
		if ( ! is_array( $body ) ) {
			$body = $request->get_params();
		}

		$table = Storyboards_Activator::scenes_table();
		$max   = (int) $wpdb->get_var( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->prepare( "SELECT COALESCE(MAX(sort_order), -1) FROM {$table} WHERE storyboard_id = %d", (int) $board->ID )
		);

		$role     = $this->sanitize_role( $body['role'] ?? 'a_roll' );
		$title    = sanitize_text_field( (string) ( $body['title'] ?? '' ) );
		$duration = $this->sanitize_duration( $body['duration_sec'] ?? 3 );

		$inserted = $wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$table,
			array(
				'storyboard_id' => (int) $board->ID,
				'sort_order'    => $max + 1,
				'role'          => $role,
				'title'         => $title,
				'description'   => sanitize_textarea_field( (string) ( $body['description'] ?? '' ) ),
				'script'        => sanitize_textarea_field( (string) ( $body['script'] ?? '' ) ),
				'duration_sec'  => $duration,
			),
			array( '%d', '%d', '%s', '%s', '%s', '%s', '%d' )
		);

		if ( false === $inserted ) {
			return new WP_Error( 'storyboards_scene_create_failed', __( 'Could not create scene.', 'storyboards' ), array( 'status' => 500 ) );
		}

		$scene = $this->get_scene_row( (int) $wpdb->insert_id );
		return new WP_REST_Response( $this->format_scene( $scene ), 201 );
	}

	/**
	 * PATCH /scenes/{id}
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function update_scene( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		global $wpdb;

		$scene = $this->get_scene_row( (int) $request['id'] );
		if ( ! $scene ) {
			return new WP_Error( 'storyboards_scene_not_found', __( 'Scene not found.', 'storyboards' ), array( 'status' => 404 ) );
		}

		$board = $this->get_board_post( (int) $scene->storyboard_id );
		if ( is_wp_error( $board ) ) {
			return $board;
		}

		$body = $request->get_json_params();
		if ( ! is_array( $body ) ) {
			$body = array();
		}

		$data   = array();
		$format = array();

		if ( array_key_exists( 'title', $body ) ) {
			$data['title'] = sanitize_text_field( (string) $body['title'] );
			$format[]      = '%s';
		}
		if ( array_key_exists( 'description', $body ) ) {
			$data['description'] = sanitize_textarea_field( (string) $body['description'] );
			$format[]            = '%s';
		}
		if ( array_key_exists( 'script', $body ) ) {
			$data['script'] = sanitize_textarea_field( (string) $body['script'] );
			$format[]       = '%s';
		}
		if ( array_key_exists( 'role', $body ) ) {
			$data['role'] = $this->sanitize_role( $body['role'] );
			$format[]     = '%s';
		}
		if ( array_key_exists( 'duration_sec', $body ) ) {
			$data['duration_sec'] = $this->sanitize_duration( $body['duration_sec'] );
			$format[]             = '%d';
		}
		$clear_image = array_key_exists( 'image_id', $body ) && null === $body['image_id'];

		if ( empty( $data ) && ! $clear_image ) {
			return new WP_REST_Response( $this->format_scene( $scene ), 200 );
		}

		$table = Storyboards_Activator::scenes_table();

		if ( ! empty( $data ) ) {
			$result = $wpdb->update( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$table,
				$data,
				array( 'id' => (int) $scene->id ),
				$format,
				array( '%d' )
			);

			if ( false === $result ) {
				return new WP_Error( 'storyboards_scene_update_failed', __( 'Could not update scene.', 'storyboards' ), array( 'status' => 500 ) );
			}
		}

		if ( $clear_image ) {
			if ( ! empty( $scene->image_id ) ) {
				wp_delete_attachment( (int) $scene->image_id, true );
			}
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query(
				$wpdb->prepare(
					"UPDATE {$table} SET image_id = NULL WHERE id = %d",
					(int) $scene->id
				)
			);
		}

		$updated = $this->get_scene_row( (int) $scene->id );
		return new WP_REST_Response( $this->format_scene( $updated ), 200 );
	}

	/**
	 * DELETE /scenes/{id}
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function delete_scene( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		global $wpdb;

		$scene = $this->get_scene_row( (int) $request['id'] );
		if ( ! $scene ) {
			return new WP_Error( 'storyboards_scene_not_found', __( 'Scene not found.', 'storyboards' ), array( 'status' => 404 ) );
		}

		$board = $this->get_board_post( (int) $scene->storyboard_id );
		if ( is_wp_error( $board ) ) {
			return $board;
		}

		if ( ! empty( $scene->image_id ) ) {
			wp_delete_attachment( (int) $scene->image_id, true );
		}

		$table = Storyboards_Activator::scenes_table();
		$wpdb->delete( $table, array( 'id' => (int) $scene->id ), array( '%d' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

		return new WP_REST_Response( array( 'deleted' => true, 'id' => (int) $scene->id ), 200 );
	}

	/**
	 * POST /boards/{id}/scenes/reorder
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function reorder_scenes( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		global $wpdb;

		$board = $this->get_board_post( (int) $request['id'] );
		if ( is_wp_error( $board ) ) {
			return $board;
		}

		$body = $request->get_json_params();
		$ids  = isset( $body['ids'] ) && is_array( $body['ids'] ) ? array_map( 'intval', $body['ids'] ) : array();

		if ( empty( $ids ) ) {
			return new WP_Error( 'storyboards_invalid_reorder', __( 'Scene ids are required.', 'storyboards' ), array( 'status' => 400 ) );
		}

		$table  = Storyboards_Activator::scenes_table();
		$board_id = (int) $board->ID;

		$existing = $wpdb->get_col( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->prepare( "SELECT id FROM {$table} WHERE storyboard_id = %d", $board_id )
		);
		$existing = array_map( 'intval', (array) $existing );
		sort( $existing );
		$sorted_ids = $ids;
		sort( $sorted_ids );

		if ( $existing !== $sorted_ids ) {
			return new WP_Error( 'storyboards_invalid_reorder', __( 'Reorder ids must match all scenes on this board.', 'storyboards' ), array( 'status' => 400 ) );
		}

		foreach ( $ids as $index => $scene_id ) {
			$wpdb->update( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$table,
				array( 'sort_order' => $index ),
				array(
					'id'            => $scene_id,
					'storyboard_id' => $board_id,
				),
				array( '%d' ),
				array( '%d', '%d' )
			);
		}

		return new WP_REST_Response( $this->get_scenes_for_board( $board_id ), 200 );
	}

	/**
	 * POST /scenes/{id}/image
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function upload_scene_image( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$scene = $this->get_scene_row( (int) $request['id'] );
		if ( ! $scene ) {
			return new WP_Error( 'storyboards_scene_not_found', __( 'Scene not found.', 'storyboards' ), array( 'status' => 404 ) );
		}

		$board = $this->get_board_post( (int) $scene->storyboard_id );
		if ( is_wp_error( $board ) ) {
			return $board;
		}

		$files = $request->get_file_params();
		if ( empty( $files['file'] ) || ! is_array( $files['file'] ) ) {
			return new WP_Error( 'storyboards_no_file', __( 'No image file uploaded.', 'storyboards' ), array( 'status' => 400 ) );
		}

		$file = $files['file'];
		if ( ! empty( $file['error'] ) ) {
			return new WP_Error( 'storyboards_upload_error', __( 'Upload failed.', 'storyboards' ), array( 'status' => 400 ) );
		}

		if ( (int) $file['size'] > self::MAX_IMAGE_BYTES ) {
			return new WP_Error(
				'storyboards_file_too_large',
				__( 'Image exceeds the 100KB server limit.', 'storyboards' ),
				array( 'status' => 400 )
			);
		}

		$check = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'] );
		$mime  = $check['type'] ?: ( $file['type'] ?? '' );
		$allowed = array( 'image/webp', 'image/jpeg', 'image/png' );
		if ( ! in_array( $mime, $allowed, true ) ) {
			return new WP_Error( 'storyboards_invalid_type', __( 'Only WebP, JPEG, or PNG images are allowed.', 'storyboards' ), array( 'status' => 400 ) );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$overrides = array(
			'test_form' => false,
			'mimes'     => array(
				'webp' => 'image/webp',
				'jpg'  => 'image/jpeg',
				'jpeg' => 'image/jpeg',
				'png'  => 'image/png',
			),
		);

		$upload = wp_handle_upload( $file, $overrides );
		if ( isset( $upload['error'] ) ) {
			return new WP_Error( 'storyboards_upload_error', $upload['error'], array( 'status' => 500 ) );
		}

		$attachment = array(
			'post_mime_type' => $upload['type'],
			'post_title'     => sanitize_file_name( pathinfo( $upload['file'], PATHINFO_FILENAME ) ),
			'post_content'   => '',
			'post_status'    => 'inherit',
			'post_parent'    => (int) $board->ID,
		);

		$attach_id = wp_insert_attachment( $attachment, $upload['file'], (int) $board->ID, true );
		if ( is_wp_error( $attach_id ) ) {
			return $attach_id;
		}

		$meta = wp_generate_attachment_metadata( $attach_id, $upload['file'] );
		wp_update_attachment_metadata( $attach_id, $meta );

		if ( ! empty( $scene->image_id ) ) {
			wp_delete_attachment( (int) $scene->image_id, true );
		}

		global $wpdb;
		$table = Storyboards_Activator::scenes_table();
		$wpdb->update( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$table,
			array( 'image_id' => $attach_id ),
			array( 'id' => (int) $scene->id ),
			array( '%d' ),
			array( '%d' )
		);

		$updated = $this->get_scene_row( (int) $scene->id );
		return new WP_REST_Response( $this->format_scene( $updated ), 200 );
	}

	/**
	 * Load and validate board post.
	 */
	private function get_board_post( int $id ): WP_Post|WP_Error {
		$post = get_post( $id );
		if ( ! $post || Storyboards_CPT::POST_TYPE !== $post->post_type ) {
			return new WP_Error( 'storyboards_not_found', __( 'Storyboard not found.', 'storyboards' ), array( 'status' => 404 ) );
		}
		return $post;
	}

	/**
	 * Fetch scene row by id.
	 *
	 * @return object|null
	 */
	private function get_scene_row( int $id ): ?object {
		global $wpdb;
		$table = Storyboards_Activator::scenes_table();
		$row   = $wpdb->get_row( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $id )
		);
		return $row ?: null;
	}

	/**
	 * All scenes for a board, ordered.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	private function get_scenes_for_board( int $board_id ): array {
		global $wpdb;
		$table = Storyboards_Activator::scenes_table();
		$rows  = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->prepare(
				"SELECT * FROM {$table} WHERE storyboard_id = %d ORDER BY sort_order ASC, id ASC",
				$board_id
			)
		);

		return array_map( array( $this, 'format_scene' ), (array) $rows );
	}

	/**
	 * Format board for API.
	 *
	 * @param WP_Post $post Post.
	 * @return array<string, mixed>
	 */
	private function format_board( WP_Post $post ): array {
		$aspect = get_post_meta( $post->ID, Storyboards_CPT::META_ASPECT, true );
		$aspect = Storyboards_CPT::sanitize_aspect( $aspect ?: '16:9' );

		return array(
			'id'           => (int) $post->ID,
			'title'        => $post->post_title,
			'aspect_ratio' => $aspect,
			'modified'     => mysql_to_rfc3339( $post->post_modified_gmt ),
			'created'      => mysql_to_rfc3339( $post->post_date_gmt ),
		);
	}

	/**
	 * Format scene for API.
	 *
	 * @param object $row DB row.
	 * @return array<string, mixed>
	 */
	private function format_scene( object $row ): array {
		$image_url = null;
		if ( ! empty( $row->image_id ) ) {
			$url = wp_get_attachment_image_url( (int) $row->image_id, 'medium' );
			if ( ! $url ) {
				$url = wp_get_attachment_url( (int) $row->image_id );
			}
			$image_url = $url ?: null;
		}

		$title = (string) $row->title;
		if ( '' === $title ) {
			$title = sprintf(
				/* translators: %d: scene number (sort order + 1) */
				__( 'Scene %d', 'storyboards' ),
				( (int) $row->sort_order ) + 1
			);
		}

		return array(
			'id'            => (int) $row->id,
			'storyboard_id' => (int) $row->storyboard_id,
			'sort_order'    => (int) $row->sort_order,
			'role'          => (string) $row->role,
			'title'         => $title,
			'title_raw'     => (string) $row->title,
			'description'   => (string) $row->description,
			'script'        => (string) $row->script,
			'duration_sec'  => (int) $row->duration_sec,
			'image_id'      => $row->image_id ? (int) $row->image_id : null,
			'image_url'     => $image_url,
		);
	}

	/**
	 * Sanitize role value.
	 */
	private function sanitize_role( mixed $role ): string {
		$role    = is_string( $role ) ? $role : 'a_roll';
		$allowed = array( 'a_roll', 'b_roll', 'voiceover' );
		return in_array( $role, $allowed, true ) ? $role : 'a_roll';
	}

	/**
	 * Sanitize duration (1–600 seconds).
	 */
	private function sanitize_duration( mixed $value ): int {
		$n = (int) $value;
		if ( $n < 1 ) {
			$n = 3;
		}
		if ( $n > 600 ) {
			$n = 600;
		}
		return $n;
	}
}
