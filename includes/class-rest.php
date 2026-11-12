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

	/** Max voiceover length in seconds. */
	private const AUDIO_MAX_SEC = 20;

	/** Max voiceover upload size in bytes (~1 MB). */
	private const AUDIO_MAX_BYTES = 1048576;

	/**
	 * Register hooks.
	 */
	public function register_hooks(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_filter( 'rest_pre_serve_request', array( $this, 'serve_export_xml' ), 10, 4 );
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
					'permission_callback' => array( $this, 'can_read_boards' ),
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
			'/boards/by-slug/(?P<slug>[a-z0-9\-]+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_board_by_slug' ),
				'permission_callback' => array( $this, 'can_read_board_request' ),
				'args'                => array(
					'slug' => array(
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_title',
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
					'permission_callback' => array( $this, 'can_read_board_request' ),
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
			'/boards/(?P<id>\d+)/export',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'export_board' ),
				'permission_callback' => array( $this, 'can_manage' ),
				'args'                => array(
					'format' => array(
						'required'          => true,
						'type'              => 'string',
						'enum'              => array(
							Storyboards_Export::FORMAT_PREMIERE,
							Storyboards_Export::FORMAT_FCP,
							Storyboards_Export::FORMAT_FCP_MEDIA,
						),
						'sanitize_callback' => 'sanitize_key',
					),
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
					'permission_callback' => array( $this, 'can_read_board_request' ),
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
			'/boards/(?P<id>\d+)/scenes/bulk-delete',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'bulk_delete_scenes' ),
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

		register_rest_route(
			self::NAMESPACE,
			'/boards/(?P<id>\d+)/audio',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'list_audio' ),
					'permission_callback' => array( $this, 'can_read_board_request' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_audio' ),
					'permission_callback' => array( $this, 'can_manage' ),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/audio/(?P<id>\d+)',
			array(
				array(
					'methods'             => 'PATCH',
					'callback'            => array( $this, 'update_audio' ),
					'permission_callback' => array( $this, 'can_manage' ),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_audio' ),
					'permission_callback' => array( $this, 'can_manage' ),
				),
			)
		);
	}

	/**
	 * Permission check for editors.
	 */
	public function can_manage(): bool {
		return current_user_can( 'manage_storyboards' );
	}

	/**
	 * List boards: managers see all; public mode is unused for overview.
	 */
	public function can_read_boards(): bool {
		return $this->can_manage();
	}

	/**
	 * Read a single board / its scenes when managing or when the board is public.
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function can_read_board_request( WP_REST_Request $request ): bool {
		if ( $this->can_manage() ) {
			return true;
		}

		$board = $this->resolve_board_from_request( $request );
		return $board instanceof WP_Post && Storyboards_CPT::is_board_public( (int) $board->ID );
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

		$ids   = array_map( static fn( $post ) => (int) $post->ID, $posts );
		$stats = $this->get_boards_stats( $ids );

		$data = array_map(
			function ( WP_Post $post ) use ( $stats ) {
				$id = (int) $post->ID;
				return $this->format_board( $post, $stats[ $id ] ?? null );
			},
			$posts
		);

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
				'post_name'   => $this->unique_board_slug( $title ),
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

		if ( ! $this->can_manage() && ! Storyboards_CPT::is_board_public( (int) $board->ID ) ) {
			return new WP_Error( 'storyboards_not_found', __( 'Storyboard not found.', 'storyboards' ), array( 'status' => 404 ) );
		}

		$data           = $this->format_board( $board );
		$data['scenes'] = $this->get_scenes_for_board( (int) $board->ID );
		$data['audio']  = $this->get_audio_for_board( (int) $board->ID );
		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * GET /boards/{id}/export?format=premiere|fcp|fcp-media
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function export_board( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$board = $this->get_board_post( (int) $request['id'] );
		if ( is_wp_error( $board ) ) {
			return $board;
		}

		$format = sanitize_key( (string) $request->get_param( 'format' ) );
		$data   = $this->format_board( $board );
		$result = Storyboards_Export::export(
			$data,
			$this->get_scenes_for_board( (int) $board->ID ),
			$this->get_audio_for_board( (int) $board->ID ),
			$format
		);

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$filename = preg_replace( '/[^a-zA-Z0-9._-]/', '-', (string) $result['filename'] );
		if ( ! is_string( $filename ) || '' === $filename ) {
			$filename = 'storyboard-export';
		}

		$body = '';
		$mime = 'application/octet-stream';
		if ( ! empty( $result['body'] ) && is_string( $result['body'] ) ) {
			$body = $result['body'];
			$mime = ! empty( $result['mime'] ) ? (string) $result['mime'] : 'application/zip';
		} elseif ( ! empty( $result['xml'] ) && is_string( $result['xml'] ) ) {
			$body = $result['xml'];
			$mime = 'application/xml; charset=UTF-8';
		} else {
			return new WP_Error(
				'storyboards_export_empty_body',
				__( 'Export produced no file.', 'storyboards' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'_storyboards_export_body'     => $body,
				'_storyboards_export_filename' => $filename,
			),
			200,
			array(
				'Content-Type'        => $mime,
				'Content-Disposition' => 'attachment; filename="' . $filename . '"',
				'Cache-Control'       => 'no-store',
			)
		);
	}

	/**
	 * Serve raw export bytes (XML or ZIP) instead of JSON-encoding the payload.
	 *
	 * @param bool             $served  Whether the request has already been served.
	 * @param WP_HTTP_Response $result  Result to send.
	 * @param WP_REST_Request  $request Request.
	 * @param WP_REST_Server   $server  Server instance.
	 */
	public function serve_export_xml( $served, $result, $request, $server ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter
		if ( $served || ! ( $result instanceof WP_REST_Response ) ) {
			return $served;
		}

		$data = $result->get_data();
		if ( ! is_array( $data ) ) {
			return $served;
		}

		$body = null;
		if ( ! empty( $data['_storyboards_export_body'] ) && is_string( $data['_storyboards_export_body'] ) ) {
			$body = $data['_storyboards_export_body'];
		} elseif ( ! empty( $data['_storyboards_export_xml'] ) && is_string( $data['_storyboards_export_xml'] ) ) {
			$body = $data['_storyboards_export_xml'];
		}

		if ( null === $body ) {
			return $served;
		}

		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- raw download body.
		echo $body;
		return true;
	}

	/**
	 * GET /boards/by-slug/{slug}
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function get_board_by_slug( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$slug  = sanitize_title( (string) $request['slug'] );
		$board = $this->get_board_post_by_slug( $slug );
		if ( is_wp_error( $board ) ) {
			return $board;
		}

		if ( ! $this->can_manage() && ! Storyboards_CPT::is_board_public( (int) $board->ID ) ) {
			return new WP_Error( 'storyboards_not_found', __( 'Storyboard not found.', 'storyboards' ), array( 'status' => 404 ) );
		}

		$data           = $this->format_board( $board );
		$data['scenes'] = $this->get_scenes_for_board( (int) $board->ID );
		$data['audio']  = $this->get_audio_for_board( (int) $board->ID );
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
			$update['post_name']  = $this->unique_board_slug( $title, (int) $board->ID );
		}

		$result = wp_update_post( $update, true );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		if ( isset( $body['aspect_ratio'] ) ) {
			update_post_meta( (int) $board->ID, Storyboards_CPT::META_ASPECT, Storyboards_CPT::sanitize_aspect( $body['aspect_ratio'] ) );
		}

		if ( array_key_exists( 'is_public', $body ) ) {
			update_post_meta( (int) $board->ID, Storyboards_CPT::META_PUBLIC, (bool) $body['is_public'] ? 1 : 0 );
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
		$start    = $this->sanitize_start( $body['start_sec'] ?? 0 );

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
				'start_sec'     => $start,
			),
			array( '%d', '%d', '%s', '%s', '%s', '%s', '%d', '%d' )
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
		if ( array_key_exists( 'start_sec', $body ) ) {
			$data['start_sec'] = $this->sanitize_start( $body['start_sec'] );
			$format[]          = '%d';
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
	 * POST /boards/{id}/scenes/bulk-delete
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function bulk_delete_scenes( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		global $wpdb;

		$board = $this->get_board_post( (int) $request['id'] );
		if ( is_wp_error( $board ) ) {
			return $board;
		}

		$body = $request->get_json_params();
		if ( ! is_array( $body ) ) {
			$body = array();
		}

		$ids = isset( $body['ids'] ) && is_array( $body['ids'] )
			? array_values( array_unique( array_map( 'intval', $body['ids'] ) ) )
			: array();
		$ids = array_values( array_filter( $ids, static fn( int $id ): bool => $id > 0 ) );

		if ( empty( $ids ) ) {
			return new WP_Error(
				'storyboards_invalid_bulk_delete',
				__( 'Select at least one scene to delete.', 'storyboards' ),
				array( 'status' => 400 )
			);
		}

		$table    = Storyboards_Activator::scenes_table();
		$board_id = (int) $board->ID;
		$deleted  = array();

		foreach ( $ids as $scene_id ) {
			$scene = $wpdb->get_row( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$wpdb->prepare(
					"SELECT id, storyboard_id, image_id FROM {$table} WHERE id = %d AND storyboard_id = %d",
					$scene_id,
					$board_id
				)
			);
			if ( ! $scene ) {
				continue;
			}

			if ( ! empty( $scene->image_id ) ) {
				wp_delete_attachment( (int) $scene->image_id, true );
			}

			$wpdb->delete( $table, array( 'id' => (int) $scene->id ), array( '%d' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$deleted[] = (int) $scene->id;
		}

		return new WP_REST_Response(
			array(
				'deleted' => true,
				'ids'     => $deleted,
				'scenes'  => $this->get_scenes_for_board( $board_id ),
			),
			200
		);
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

		// Hard block videos and any non-photo payloads (storyboards are reference stills only).
		if ( is_string( $mime ) && str_starts_with( $mime, 'video/' ) ) {
			return new WP_Error(
				'storyboards_video_not_allowed',
				__( 'Videos cannot be uploaded to storyboards. Please use a photo (JPEG, PNG, or WebP).', 'storyboards' ),
				array( 'status' => 400 )
			);
		}

		if ( ! in_array( $mime, $allowed, true ) ) {
			return new WP_Error(
				'storyboards_invalid_type',
				__( 'Only JPEG, PNG, or WebP photos are allowed. Videos cannot be uploaded.', 'storyboards' ),
				array( 'status' => 400 )
			);
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
	 * Load board post by slug.
	 */
	private function get_board_post_by_slug( string $slug ): WP_Post|WP_Error {
		$slug = sanitize_title( $slug );
		if ( '' === $slug ) {
			return new WP_Error( 'storyboards_not_found', __( 'Storyboard not found.', 'storyboards' ), array( 'status' => 404 ) );
		}

		$posts = get_posts(
			array(
				'name'             => $slug,
				'post_type'        => Storyboards_CPT::POST_TYPE,
				'post_status'      => array( 'private', 'publish', 'draft' ),
				'posts_per_page'   => 1,
				'suppress_filters' => true,
			)
		);

		if ( empty( $posts[0] ) || ! ( $posts[0] instanceof WP_Post ) ) {
			return new WP_Error( 'storyboards_not_found', __( 'Storyboard not found.', 'storyboards' ), array( 'status' => 404 ) );
		}

		return $posts[0];
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
	 * Aggregate scene count and duration for board IDs.
	 *
	 * @param int[] $board_ids Board post IDs.
	 * @return array<int, array{scene_count:int,total_duration_sec:int}>
	 */
	private function get_boards_stats( array $board_ids ): array {
		$board_ids = array_values( array_filter( array_map( 'intval', $board_ids ) ) );
		if ( empty( $board_ids ) ) {
			return array();
		}

		global $wpdb;
		$table = Storyboards_Activator::scenes_table();
		$in    = implode( ',', array_fill( 0, count( $board_ids ), '%d' ) );

		// Duration counts A-roll only — B-roll overlays A-roll and does not extend program length.
		// phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$sql = $wpdb->prepare(
			"SELECT storyboard_id,
				COUNT(*) AS scene_count,
				COALESCE(SUM(CASE WHEN role = 'a_roll' THEN duration_sec ELSE 0 END), 0) AS total_duration_sec
			FROM {$table}
			WHERE storyboard_id IN ({$in})
			GROUP BY storyboard_id",
			...$board_ids
		);

		$rows = $wpdb->get_results( $sql ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared

		$stats = array();
		foreach ( (array) $rows as $row ) {
			$stats[ (int) $row->storyboard_id ] = array(
				'scene_count'         => (int) $row->scene_count,
				'total_duration_sec'  => (int) $row->total_duration_sec,
			);
		}

		return $stats;
	}

	/**
	 * Format board for API.
	 *
	 * @param WP_Post                              $post  Post.
	 * @param array{scene_count?:int,total_duration_sec?:int}|null $stats Optional preloaded stats.
	 * @return array<string, mixed>
	 */
	private function format_board( WP_Post $post, ?array $stats = null ): array {
		$aspect = get_post_meta( $post->ID, Storyboards_CPT::META_ASPECT, true );
		$aspect = Storyboards_CPT::sanitize_aspect( $aspect ?: '16:9' );

		if ( null === $stats ) {
			$loaded = $this->get_boards_stats( array( (int) $post->ID ) );
			$stats  = $loaded[ (int) $post->ID ] ?? array(
				'scene_count'        => 0,
				'total_duration_sec' => 0,
			);
		}

		$slug = (string) $post->post_name;
		if ( '' === $slug ) {
			$slug = $this->unique_board_slug( (string) $post->post_title, (int) $post->ID );
			wp_update_post(
				array(
					'ID'        => (int) $post->ID,
					'post_name' => $slug,
				)
			);
		}

		return array(
			'id'                 => (int) $post->ID,
			'title'              => $post->post_title,
			'slug'               => $slug,
			'url'                => Storyboards_Rewrite::board_url( $slug ),
			'aspect_ratio'       => $aspect,
			'is_public'          => Storyboards_CPT::is_board_public( (int) $post->ID ),
			'scene_count'        => (int) ( $stats['scene_count'] ?? 0 ),
			'total_duration_sec' => (int) ( $stats['total_duration_sec'] ?? 0 ),
			'modified'           => mysql_to_rfc3339( $post->post_modified_gmt ),
			'created'            => mysql_to_rfc3339( $post->post_date_gmt ),
		);
	}

	/**
	 * Resolve board post from a REST request (board id or slug).
	 *
	 * @param WP_REST_Request $request Request.
	 */
	private function resolve_board_from_request( WP_REST_Request $request ): ?WP_Post {
		if ( ! empty( $request['slug'] ) ) {
			$board = $this->get_board_post_by_slug( sanitize_title( (string) $request['slug'] ) );
			return is_wp_error( $board ) ? null : $board;
		}

		$route = (string) $request->get_route();
		if ( isset( $request['id'] ) && str_contains( $route, '/boards/' ) ) {
			$board = $this->get_board_post( (int) $request['id'] );
			return is_wp_error( $board ) ? null : $board;
		}

		return null;
	}

	/**
	 * Build a unique post_name for a storyboard title.
	 */
	private function unique_board_slug( string $title, int $post_id = 0 ): string {
		$slug = sanitize_title( $title );
		if ( '' === $slug ) {
			$slug = 'board';
		}

		return wp_unique_post_slug(
			$slug,
			$post_id,
			'private',
			Storyboards_CPT::POST_TYPE,
			0
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
			'start_sec'     => isset( $row->start_sec ) ? (int) $row->start_sec : 0,
			'image_id'      => $row->image_id ? (int) $row->image_id : null,
			'image_url'     => $image_url,
		);
	}

	/**
	 * GET /boards/{id}/audio
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function list_audio( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$board = $this->get_board_post( (int) $request['id'] );
		if ( is_wp_error( $board ) ) {
			return $board;
		}
		return new WP_REST_Response( $this->get_audio_for_board( (int) $board->ID ), 200 );
	}

	/**
	 * Allowed audio extensions → MIME map for recorded voiceovers.
	 *
	 * @return array<string, string>
	 */
	private function audio_upload_mimes(): array {
		return array(
			'webm' => 'audio/webm',
			'weba' => 'audio/webm',
			'ogg'  => 'audio/ogg',
			'oga'  => 'audio/ogg',
			'mp3'  => 'audio/mpeg',
			'm4a'  => 'audio/mp4',
			'mp4'  => 'audio/mp4',
			'wav'  => 'audio/wav',
		);
	}

	/**
	 * POST /boards/{id}/audio — multipart file upload (recorded voiceover).
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function create_audio( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$board = $this->get_board_post( (int) $request['id'] );
		if ( is_wp_error( $board ) ) {
			return $board;
		}

		$files = $request->get_file_params();
		if ( empty( $files['file'] ) || ! is_array( $files['file'] ) ) {
			return new WP_Error( 'storyboards_audio_missing', __( 'Audio file is required.', 'storyboards' ), array( 'status' => 400 ) );
		}

		$file = $files['file'];
		$size = isset( $file['size'] ) ? (int) $file['size'] : 0;
		if ( $size < 1 ) {
			return new WP_Error( 'storyboards_audio_empty', __( 'Audio file is empty.', 'storyboards' ), array( 'status' => 400 ) );
		}
		if ( $size > self::AUDIO_MAX_BYTES ) {
			return new WP_Error( 'storyboards_audio_too_large', __( 'Audio must be 1 MB or smaller.', 'storyboards' ), array( 'status' => 400 ) );
		}

		$filename = isset( $file['name'] ) ? (string) $file['name'] : '';
		$ext      = strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) );
		$allowed  = $this->audio_upload_mimes();
		if ( '' === $ext || ! isset( $allowed[ $ext ] ) ) {
			return new WP_Error( 'storyboards_audio_type', __( 'Only audio files are allowed.', 'storyboards' ), array( 'status' => 400 ) );
		}

		// Browser Content-Type can be video/webm for audio-only recordings — accept both.
		$type = isset( $file['type'] ) ? strtolower( (string) $file['type'] ) : '';
		$type = strtok( $type, ';' ) ?: '';
		if (
			$type
			&& 0 !== strpos( $type, 'audio/' )
			&& 'video/webm' !== $type
			&& 'application/octet-stream' !== $type
		) {
			return new WP_Error( 'storyboards_audio_type', __( 'Only audio files are allowed.', 'storyboards' ), array( 'status' => 400 ) );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$mime_map = $allowed;

		// Bypass image-only / core MIME checks for this voiceover upload only.
		$mime_filter = static function ( array $mimes ) use ( $mime_map ): array {
			foreach ( $mime_map as $extension => $mime ) {
				$mimes[ $extension ] = $mime;
			}
			return $mimes;
		};

		$filetype_filter = static function ( $data, $file_path, $filename_check, $mimes ) use ( $mime_map ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter
			$check_ext = strtolower( pathinfo( (string) $filename_check, PATHINFO_EXTENSION ) );
			if ( isset( $mime_map[ $check_ext ] ) ) {
				return array(
					'ext'             => $check_ext,
					'type'            => $mime_map[ $check_ext ],
					'proper_filename' => $filename_check,
				);
			}
			return $data;
		};

		add_filter( 'upload_mimes', $mime_filter, 99 );
		add_filter( 'wp_check_filetype_and_ext', $filetype_filter, 99, 4 );

		$attachment_id = media_handle_upload( 'file', (int) $board->ID );

		remove_filter( 'upload_mimes', $mime_filter, 99 );
		remove_filter( 'wp_check_filetype_and_ext', $filetype_filter, 99 );

		if ( is_wp_error( $attachment_id ) ) {
			return $attachment_id;
		}

		$title    = sanitize_text_field( (string) $request->get_param( 'title' ) );
		$start    = $this->sanitize_start( $request->get_param( 'start_sec' ) ?? 0 );
		$duration = $this->sanitize_audio_duration( $request->get_param( 'duration_sec' ) ?? 1 );
		$track    = $this->sanitize_audio_track( $request->get_param( 'track' ) ?? 1 );

		if ( '' === $title ) {
			$title = __( 'Voiceover', 'storyboards' );
		}

		global $wpdb;
		$table    = Storyboards_Activator::audio_table();
		$inserted = $wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$table,
			array(
				'storyboard_id' => (int) $board->ID,
				'track'         => $track,
				'title'         => $title,
				'start_sec'     => $start,
				'duration_sec'  => $duration,
				'attachment_id' => (int) $attachment_id,
			),
			array( '%d', '%d', '%s', '%d', '%d', '%d' )
		);

		if ( false === $inserted ) {
			wp_delete_attachment( (int) $attachment_id, true );
			return new WP_Error( 'storyboards_audio_create_failed', __( 'Could not save audio clip.', 'storyboards' ), array( 'status' => 500 ) );
		}

		$clip = $this->get_audio_row( (int) $wpdb->insert_id );
		return new WP_REST_Response( $this->format_audio( $clip ), 201 );
	}

	/**
	 * PATCH /audio/{id}
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function update_audio( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		global $wpdb;

		$clip = $this->get_audio_row( (int) $request['id'] );
		if ( ! $clip ) {
			return new WP_Error( 'storyboards_audio_not_found', __( 'Audio clip not found.', 'storyboards' ), array( 'status' => 404 ) );
		}

		$board = $this->get_board_post( (int) $clip->storyboard_id );
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
		if ( array_key_exists( 'start_sec', $body ) ) {
			$data['start_sec'] = $this->sanitize_start( $body['start_sec'] );
			$format[]          = '%d';
		}
		if ( array_key_exists( 'duration_sec', $body ) ) {
			$data['duration_sec'] = $this->sanitize_audio_duration( $body['duration_sec'] );
			$format[]             = '%d';
		}
		if ( array_key_exists( 'track', $body ) ) {
			$data['track'] = $this->sanitize_audio_track( $body['track'] );
			$format[]      = '%d';
		}

		if ( empty( $data ) ) {
			return new WP_REST_Response( $this->format_audio( $clip ), 200 );
		}

		$table  = Storyboards_Activator::audio_table();
		$result = $wpdb->update( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$table,
			$data,
			array( 'id' => (int) $clip->id ),
			$format,
			array( '%d' )
		);

		if ( false === $result ) {
			return new WP_Error( 'storyboards_audio_update_failed', __( 'Could not update audio clip.', 'storyboards' ), array( 'status' => 500 ) );
		}

		$updated = $this->get_audio_row( (int) $clip->id );
		return new WP_REST_Response( $this->format_audio( $updated ), 200 );
	}

	/**
	 * DELETE /audio/{id}
	 *
	 * @param WP_REST_Request $request Request.
	 */
	public function delete_audio( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		global $wpdb;

		$clip = $this->get_audio_row( (int) $request['id'] );
		if ( ! $clip ) {
			return new WP_Error( 'storyboards_audio_not_found', __( 'Audio clip not found.', 'storyboards' ), array( 'status' => 404 ) );
		}

		$board = $this->get_board_post( (int) $clip->storyboard_id );
		if ( is_wp_error( $board ) ) {
			return $board;
		}

		if ( ! empty( $clip->attachment_id ) ) {
			wp_delete_attachment( (int) $clip->attachment_id, true );
		}

		$table = Storyboards_Activator::audio_table();
		$wpdb->delete( $table, array( 'id' => (int) $clip->id ), array( '%d' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

		return new WP_REST_Response( array( 'deleted' => true, 'id' => (int) $clip->id ), 200 );
	}

	/**
	 * @param int $board_id Board ID.
	 * @return array<int, array<string, mixed>>
	 */
	private function get_audio_for_board( int $board_id ): array {
		global $wpdb;
		$table = Storyboards_Activator::audio_table();
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM {$table} WHERE storyboard_id = %d ORDER BY track ASC, start_sec ASC, id ASC",
				$board_id
			)
		);
		return array_map( array( $this, 'format_audio' ), (array) $rows );
	}

	/**
	 * @param int $id Audio ID.
	 */
	private function get_audio_row( int $id ): ?object {
		global $wpdb;
		$table = Storyboards_Activator::audio_table();
		$row   = $wpdb->get_row( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", $id )
		);
		return $row ?: null;
	}

	/**
	 * @param object $row DB row.
	 * @return array<string, mixed>
	 */
	private function format_audio( object $row ): array {
		$url = null;
		if ( ! empty( $row->attachment_id ) ) {
			$url = wp_get_attachment_url( (int) $row->attachment_id ) ?: null;
		}
		return array(
			'id'            => (int) $row->id,
			'storyboard_id' => (int) $row->storyboard_id,
			'track'         => $this->sanitize_audio_track( $row->track ?? 1 ),
			'title'         => (string) $row->title,
			'start_sec'     => (int) $row->start_sec,
			'duration_sec'  => (int) $row->duration_sec,
			'attachment_id' => $row->attachment_id ? (int) $row->attachment_id : null,
			'url'           => $url,
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
	 * Sanitize timeline start (0–7200 seconds).
	 */
	private function sanitize_start( mixed $value ): int {
		$n = (int) $value;
		if ( $n < 0 ) {
			return 0;
		}
		if ( $n > 7200 ) {
			return 7200;
		}
		return $n;
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

	/**
	 * Sanitize recorded voiceover duration (1–20 seconds).
	 */
	private function sanitize_audio_duration( mixed $value ): int {
		$n = (int) $value;
		if ( $n < 1 ) {
			$n = 1;
		}
		if ( $n > self::AUDIO_MAX_SEC ) {
			$n = self::AUDIO_MAX_SEC;
		}
		return $n;
	}

	/**
	 * Sanitize audio lane index (1–2).
	 */
	private function sanitize_audio_track( mixed $value ): int {
		$n = (int) $value;
		if ( $n < 1 ) {
			return 1;
		}
		if ( $n > 2 ) {
			return 2;
		}
		return $n;
	}
}
