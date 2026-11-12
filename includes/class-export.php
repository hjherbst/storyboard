<?php
/**
 * Timeline export for Premiere (FCP7 XML) and Final Cut (FCPXML),
 * including optional FCP media ZIP packages.
 *
 * @package Storyboards
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Storyboards_Export {

	public const FPS             = 25;
	public const FORMAT_PREMIERE = 'premiere';
	public const FORMAT_FCP      = 'fcp';
	public const FORMAT_FCP_MEDIA = 'fcp-media';

	/**
	 * Build export payload for a board.
	 *
	 * @param array{id:int,title:string,aspect_ratio?:string} $board  Board data.
	 * @param array<int, array<string, mixed>>                $scenes Scene rows.
	 * @param array<int, array<string, mixed>>                $audio  Audio rows.
	 * @param string                                          $format premiere|fcp|fcp-media.
	 * @return array{xml?:string,body?:string,filename:string,mime?:string}|WP_Error
	 */
	public static function export( array $board, array $scenes, array $audio, string $format ): array|WP_Error {
		$format = sanitize_key( $format );
		$allowed = array( self::FORMAT_PREMIERE, self::FORMAT_FCP, self::FORMAT_FCP_MEDIA );
		if ( ! in_array( $format, $allowed, true ) ) {
			return new WP_Error(
				'storyboards_export_format',
				__( 'Unknown export format.', 'storyboards' ),
				array( 'status' => 400 )
			);
		}

		$timeline = self::build_timeline( $board, $scenes, $audio );
		if ( is_wp_error( $timeline ) ) {
			return $timeline;
		}

		$slug = self::filename_slug( (string) ( $board['title'] ?? 'storyboard' ) );

		if ( self::FORMAT_PREMIERE === $format ) {
			return array(
				'xml'      => self::to_premiere_xml( $timeline ),
				'filename' => $slug . '-premiere.xml',
				'mime'     => 'application/xml',
			);
		}

		if ( self::FORMAT_FCP_MEDIA === $format ) {
			return self::build_fcp_media_zip( $timeline, $scenes, $audio, $slug );
		}

		return array(
			'xml'      => self::to_fcpxml( $timeline ),
			'filename' => $slug . '.fcpxml',
			'mime'     => 'application/xml',
		);
	}

	/**
	 * Normalize board scenes/audio into a frame-based timeline model.
	 *
	 * @param array{id?:int,title?:string,aspect_ratio?:string} $board  Board.
	 * @param array<int, array<string, mixed>>                  $scenes Scenes.
	 * @param array<int, array<string, mixed>>                  $audio  Audio.
	 * @return array{
	 *   name:string,
	 *   width:int,
	 *   height:int,
	 *   fps:int,
	 *   duration_frames:int,
	 *   v1:array<int, array{id:string,name:string,start:int,duration:int}>,
	 *   v2:array<int, array{id:string,name:string,start:int,duration:int}>,
	 *   a1:array<int, array{id:string,name:string,start:int,duration:int}>,
	 *   a2:array<int, array{id:string,name:string,start:int,duration:int}>
	 * }|WP_Error
	 */
	public static function build_timeline( array $board, array $scenes, array $audio ): array|WP_Error {
		$aspect = Storyboards_CPT::sanitize_aspect( (string) ( $board['aspect_ratio'] ?? '16:9' ) );
		$width  = '9:16' === $aspect ? 1080 : 1920;
		$height = '9:16' === $aspect ? 1920 : 1080;

		$v1     = array();
		$cursor = 0;
		$idx    = 0;

		foreach ( $scenes as $scene ) {
			$role = (string) ( $scene['role'] ?? 'a_roll' );
			if ( 'a_roll' !== $role ) {
				continue;
			}
			++$idx;
			$dur = self::duration_frames( (int) ( $scene['duration_sec'] ?? 3 ) );
			$v1[] = array(
				'id'            => 'a-' . (int) ( $scene['id'] ?? $idx ),
				'name'          => self::clip_name( $scene, $idx ),
				'start'         => $cursor,
				'duration'      => $dur,
				'attachment_id' => ! empty( $scene['image_id'] ) ? (int) $scene['image_id'] : 0,
			);
			$cursor += $dur;
		}

		if ( ! $v1 ) {
			return new WP_Error(
				'storyboards_export_empty',
				__( 'Add at least one A-roll scene before exporting.', 'storyboards' ),
				array( 'status' => 400 )
			);
		}

		$duration_frames = $cursor;
		$v2              = array();
		$b_idx           = 0;
		foreach ( $scenes as $scene ) {
			if ( 'b_roll' !== (string) ( $scene['role'] ?? '' ) ) {
				continue;
			}
			++$b_idx;
			$v2[] = array(
				'id'            => 'b-' . (int) ( $scene['id'] ?? $b_idx ),
				'name'          => self::clip_name( $scene, $b_idx ),
				'start'         => self::start_frames( (int) ( $scene['start_sec'] ?? 0 ) ),
				'duration'      => self::duration_frames( (int) ( $scene['duration_sec'] ?? 3 ) ),
				'attachment_id' => ! empty( $scene['image_id'] ) ? (int) $scene['image_id'] : 0,
			);
		}

		$a1 = array();
		$a2 = array();
		foreach ( $audio as $clip ) {
			$track = (int) ( $clip['track'] ?? 1 ) === 2 ? 2 : 1;
			$item  = array(
				'id'            => 'aud-' . (int) ( $clip['id'] ?? 0 ),
				'name'          => self::audio_name( $clip ),
				'start'         => self::start_frames( (int) ( $clip['start_sec'] ?? 0 ) ),
				'duration'      => self::duration_frames( (int) ( $clip['duration_sec'] ?? 1 ) ),
				'attachment_id' => ! empty( $clip['attachment_id'] ) ? (int) $clip['attachment_id'] : 0,
			);
			if ( 2 === $track ) {
				$a2[] = $item;
			} else {
				$a1[] = $item;
			}
		}

		return array(
			'name'             => (string) ( $board['title'] ?? 'Storyboard' ),
			'width'            => $width,
			'height'           => $height,
			'fps'              => self::FPS,
			'duration_frames'  => $duration_frames,
			'v1'               => $v1,
			'v2'               => $v2,
			'a1'               => $a1,
			'a2'               => $a2,
		);
	}

	/**
	 * FCP7 / XMEML XML for Premiere Pro.
	 *
	 * @param array<string, mixed> $timeline Timeline model.
	 */
	public static function to_premiere_xml( array $timeline ): string {
		$dom               = new DOMDocument( '1.0', 'UTF-8' );
		$dom->formatOutput = true;

		$root = $dom->createElement( 'xmeml' );
		$root->setAttribute( 'version', '5' );
		$dom->appendChild( $root );

		$sequence = $dom->createElement( 'sequence' );
		$sequence->setAttribute( 'id', 'sequence-1' );
		$root->appendChild( $sequence );

		self::append_text( $dom, $sequence, 'name', (string) $timeline['name'] );
		self::append_text( $dom, $sequence, 'duration', (string) (int) $timeline['duration_frames'] );
		$sequence->appendChild( self::premiere_rate( $dom ) );

		$media = $dom->createElement( 'media' );
		$sequence->appendChild( $media );

		$video = $dom->createElement( 'video' );
		$media->appendChild( $video );

		$format = $dom->createElement( 'format' );
		$video->appendChild( $format );
		$sample = $dom->createElement( 'samplecharacteristics' );
		$format->appendChild( $sample );
		$sample->appendChild( self::premiere_rate( $dom ) );
		self::append_text( $dom, $sample, 'width', (string) (int) $timeline['width'] );
		self::append_text( $dom, $sample, 'height', (string) (int) $timeline['height'] );
		self::append_text( $dom, $sample, 'pixelaspectratio', 'square' );
		self::append_text( $dom, $sample, 'fielddominance', 'none' );

		$file_ids = array();
		$video->appendChild(
			self::premiere_video_track(
				$dom,
				$timeline,
				(array) $timeline['v1'],
				$file_ids,
				'v1'
			)
		);
		$video->appendChild(
			self::premiere_video_track(
				$dom,
				$timeline,
				(array) $timeline['v2'],
				$file_ids,
				'v2'
			)
		);

		$audio = $dom->createElement( 'audio' );
		$media->appendChild( $audio );
		$audio->appendChild(
			self::premiere_audio_track(
				$dom,
				$timeline,
				(array) $timeline['a1'],
				$file_ids,
				'a1'
			)
		);
		$audio->appendChild(
			self::premiere_audio_track(
				$dom,
				$timeline,
				(array) $timeline['a2'],
				$file_ids,
				'a2'
			)
		);

		$tc = $dom->createElement( 'timecode' );
		$sequence->appendChild( $tc );
		$tc->appendChild( self::premiere_rate( $dom ) );
		self::append_text( $dom, $tc, 'string', '00:00:00:00' );
		self::append_text( $dom, $tc, 'frame', '0' );
		self::append_text( $dom, $tc, 'displayformat', 'NDF' );

		$xml = $dom->saveXML();
		return is_string( $xml ) ? $xml : '';
	}

	/**
	 * FCPXML 1.9 for Final Cut Pro.
	 *
	 * Stills must use <video> (not <asset-clip>) or FCP crashes in addAssetClip.
	 * A-roll sits on the spine; B-roll/audio attach as connected clips.
	 *
	 * @param array<string, mixed>                                                          $timeline  Timeline model.
	 * @param array<string, array{src:string,has_video?:bool,has_audio?:bool}>|null $media_map Optional clip-id → media src (relative).
	 */
	public static function to_fcpxml( array $timeline, ?array $media_map = null ): string {
		$dom               = new DOMDocument( '1.0', 'UTF-8' );
		$dom->formatOutput = true;

		$root = $dom->createElement( 'fcpxml' );
		$root->setAttribute( 'version', '1.9' );
		$dom->appendChild( $root );

		$resources = $dom->createElement( 'resources' );
		$root->appendChild( $resources );

		$seq_format_id = 'r1';
		$seq_format    = $dom->createElement( 'format' );
		$seq_format->setAttribute( 'id', $seq_format_id );
		$seq_format->setAttribute( 'name', 'FFVideoFormat' . (int) $timeline['height'] . 'p' . self::FPS );
		$seq_format->setAttribute( 'frameDuration', self::fcpxml_frame_duration() );
		$seq_format->setAttribute( 'width', (string) (int) $timeline['width'] );
		$seq_format->setAttribute( 'height', (string) (int) $timeline['height'] );
		$resources->appendChild( $seq_format );

		// Still-image format must NOT set frameDuration (FCP crash otherwise).
		$still_format_id = 'r2';
		$still_format    = $dom->createElement( 'format' );
		$still_format->setAttribute( 'id', $still_format_id );
		$still_format->setAttribute( 'name', 'FFStillFormat' . (int) $timeline['width'] . 'x' . (int) $timeline['height'] );
		$still_format->setAttribute( 'width', (string) (int) $timeline['width'] );
		$still_format->setAttribute( 'height', (string) (int) $timeline['height'] );
		$resources->appendChild( $still_format );

		$asset_map = array();
		$rid       = 3;
		$media_map = is_array( $media_map ) ? $media_map : array();

		foreach ( array( 'v1', 'v2' ) as $lane ) {
			foreach ( (array) $timeline[ $lane ] as $clip ) {
				$aid = 'r' . $rid;
				++$rid;
				$cid = (string) $clip['id'];
				$asset_map[ $cid ] = $aid;
				$src = isset( $media_map[ $cid ]['src'] ) ? (string) $media_map[ $cid ]['src'] : '';
				$resources->appendChild(
					self::fcpxml_still_asset(
						$dom,
						$aid,
						$still_format_id,
						(string) $clip['name'],
						$src
					)
				);
			}
		}

		foreach ( array( 'a1', 'a2' ) as $lane ) {
			foreach ( (array) $timeline[ $lane ] as $clip ) {
				$aid = 'r' . $rid;
				++$rid;
				$cid = (string) $clip['id'];
				$asset_map[ $cid ] = $aid;
				$src = isset( $media_map[ $cid ]['src'] ) ? (string) $media_map[ $cid ]['src'] : '';
				$resources->appendChild(
					self::fcpxml_audio_asset(
						$dom,
						$aid,
						(string) $clip['name'],
						(int) $clip['duration'],
						$src
					)
				);
			}
		}

		$library = $dom->createElement( 'library' );
		$root->appendChild( $library );

		$event = $dom->createElement( 'event' );
		$event->setAttribute( 'name', 'Storyboards' );
		$library->appendChild( $event );

		$project = $dom->createElement( 'project' );
		$project->setAttribute( 'name', (string) $timeline['name'] );
		$event->appendChild( $project );

		$sequence = $dom->createElement( 'sequence' );
		$sequence->setAttribute( 'format', $seq_format_id );
		$sequence->setAttribute( 'duration', self::fcpxml_time( (int) $timeline['duration_frames'] ) );
		$sequence->setAttribute( 'tcStart', '0s' );
		$sequence->setAttribute( 'tcFormat', 'NDF' );
		$sequence->setAttribute( 'audioLayout', 'stereo' );
		$sequence->setAttribute( 'audioRate', '48k' );
		$project->appendChild( $sequence );

		$spine = $dom->createElement( 'spine' );
		$sequence->appendChild( $spine );

		$v1 = (array) $timeline['v1'];
		$v2 = (array) $timeline['v2'];
		$a1 = (array) $timeline['a1'];
		$a2 = (array) $timeline['a2'];

		// Primary storyline = A-roll; fall back to B-roll if no A-roll.
		$primary    = count( $v1 ) > 0 ? $v1 : $v2;
		$secondary  = count( $v1 ) > 0 ? $v2 : array();
		$attached_b = array();
		$attached_a = array();

		foreach ( $primary as $index => $clip ) {
			$cid  = (string) $clip['id'];
			$node = self::fcpxml_video_clip(
				$dom,
				$asset_map[ $cid ],
				(string) $clip['name'],
				(int) $clip['start'],
				(int) $clip['duration'],
				null
			);

			$a_start = (int) $clip['start'];
			$a_end   = $a_start + (int) $clip['duration'];
			$is_last = ( $index === count( $primary ) - 1 );

			foreach ( $secondary as $b ) {
				$bid = (string) $b['id'];
				if ( isset( $attached_b[ $bid ] ) ) {
					continue;
				}
				$b_start = (int) $b['start'];
				$belongs = ( $b_start >= $a_start && $b_start < $a_end )
					|| ( $is_last && $b_start >= $a_end )
					|| ( 0 === $index && $b_start < $a_start );
				if ( ! $belongs ) {
					continue;
				}
				$attached_b[ $bid ] = true;
				$node->appendChild(
					self::fcpxml_video_clip(
						$dom,
						$asset_map[ $bid ],
						(string) $b['name'],
						max( 0, $b_start - $a_start ),
						(int) $b['duration'],
						1
					)
				);
			}

			foreach ( array( 1 => $a1, 2 => $a2 ) as $lane_n => $aud_clips ) {
				foreach ( $aud_clips as $aud ) {
					$aid_key = (string) $aud['id'];
					if ( isset( $attached_a[ $aid_key ] ) ) {
						continue;
					}
					$s = (int) $aud['start'];
					$belongs = ( $s >= $a_start && $s < $a_end )
						|| ( $is_last && $s >= $a_end )
						|| ( 0 === $index && $s < $a_start );
					if ( ! $belongs ) {
						continue;
					}
					$attached_a[ $aid_key ] = true;
					$node->appendChild(
						self::fcpxml_audio_clip(
							$dom,
							$asset_map[ $aid_key ],
							(string) $aud['name'],
							max( 0, $s - $a_start ),
							(int) $aud['duration'],
							1 === (int) $lane_n ? -1 : -2
						)
					);
				}
			}

			$spine->appendChild( $node );
		}

		// Audio-only board: gap on spine, audio as connected clips.
		if ( 0 === count( $primary ) && ( count( $a1 ) > 0 || count( $a2 ) > 0 ) ) {
			$gap = $dom->createElement( 'gap' );
			$gap->setAttribute( 'name', 'Gap' );
			$gap->setAttribute( 'offset', '0s' );
			$gap->setAttribute( 'duration', self::fcpxml_time( (int) $timeline['duration_frames'] ) );
			foreach ( array( 1 => $a1, 2 => $a2 ) as $lane_n => $aud_clips ) {
				foreach ( $aud_clips as $aud ) {
					$gap->appendChild(
						self::fcpxml_audio_clip(
							$dom,
							$asset_map[ (string) $aud['id'] ],
							(string) $aud['name'],
							(int) $aud['start'],
							(int) $aud['duration'],
							1 === (int) $lane_n ? -1 : -2
						)
					);
				}
			}
			$spine->appendChild( $gap );
		}

		$xml = $dom->saveXML();
		return is_string( $xml ) ? $xml : '';
	}

	/**
	 * @param array<string, mixed> $scene Scene.
	 * @param int                  $index 1-based fallback index.
	 */
	private static function clip_name( array $scene, int $index ): string {
		$title = trim( (string) ( $scene['title'] ?? '' ) );
		if ( '' !== $title ) {
			return $title;
		}
		return sprintf(
			/* translators: %d: scene number */
			__( 'Scene %d', 'storyboards' ),
			$index
		);
	}

	/**
	 * @param array<string, mixed> $clip Audio clip.
	 */
	private static function audio_name( array $clip ): string {
		$title = trim( (string) ( $clip['title'] ?? '' ) );
		if ( '' !== $title ) {
			return $title;
		}
		return __( 'Voice over', 'storyboards' );
	}

	private static function start_frames( int $sec ): int {
		return max( 0, (int) round( max( 0, $sec ) * self::FPS ) );
	}

	private static function duration_frames( int $sec ): int {
		return max( 1, (int) round( max( 0, $sec ) * self::FPS ) );
	}

	private static function filename_slug( string $title ): string {
		$slug = sanitize_title( $title );
		if ( '' === $slug ) {
			$slug = 'storyboard';
		}
		return $slug;
	}

	private static function fcpxml_frame_duration(): string {
		// 1 frame at 25 fps = 100/2500 seconds.
		return '100/2500s';
	}

	private static function fcpxml_time( int $frames ): string {
		$frames = max( 0, $frames );
		return ( $frames * 100 ) . '/2500s';
	}

	/**
	 * @param DOMDocument          $dom      DOM.
	 * @param array<string, mixed> $timeline Timeline.
	 * @param array<int, array{id:string,name:string,start:int,duration:int}> $clips Clips.
	 * @param array<string, bool>  $file_ids Used file ids (by ref).
	 * @param string               $prefix   Track prefix.
	 */
	private static function premiere_video_track(
		DOMDocument $dom,
		array $timeline,
		array $clips,
		array &$file_ids,
		string $prefix
	): DOMElement {
		$track = $dom->createElement( 'track' );
		$n     = 0;
		foreach ( $clips as $clip ) {
			++$n;
			$clip_id = $prefix . '-clip-' . $n;
			$file_id = $prefix . '-file-' . $n;
			$file_ids[ $file_id ] = true;

			$item = $dom->createElement( 'clipitem' );
			$item->setAttribute( 'id', $clip_id );
			$track->appendChild( $item );

			self::append_text( $dom, $item, 'name', (string) $clip['name'] );
			self::append_text( $dom, $item, 'enabled', 'TRUE' );
			self::append_text( $dom, $item, 'duration', (string) (int) $clip['duration'] );
			$item->appendChild( self::premiere_rate( $dom ) );
			self::append_text( $dom, $item, 'start', (string) (int) $clip['start'] );
			self::append_text( $dom, $item, 'end', (string) ( (int) $clip['start'] + (int) $clip['duration'] ) );
			self::append_text( $dom, $item, 'in', '0' );
			self::append_text( $dom, $item, 'out', (string) (int) $clip['duration'] );

			$file = $dom->createElement( 'file' );
			$file->setAttribute( 'id', $file_id );
			$item->appendChild( $file );
			self::append_text( $dom, $file, 'name', (string) $clip['name'] );
			self::append_text( $dom, $file, 'pathurl', 'file://localhost/storyboards/placeholder.mov' );
			$file->appendChild( self::premiere_rate( $dom ) );
			self::append_text( $dom, $file, 'duration', (string) (int) $clip['duration'] );

			$fmedia = $dom->createElement( 'media' );
			$file->appendChild( $fmedia );
			$fvideo = $dom->createElement( 'video' );
			$fmedia->appendChild( $fvideo );
			$sch = $dom->createElement( 'samplecharacteristics' );
			$fvideo->appendChild( $sch );
			$sch->appendChild( self::premiere_rate( $dom ) );
			self::append_text( $dom, $sch, 'width', (string) (int) $timeline['width'] );
			self::append_text( $dom, $sch, 'height', (string) (int) $timeline['height'] );
		}

		self::append_text( $dom, $track, 'enabled', 'TRUE' );
		self::append_text( $dom, $track, 'locked', 'FALSE' );
		return $track;
	}

	/**
	 * @param DOMDocument          $dom      DOM.
	 * @param array<string, mixed> $timeline Timeline (unused dims; kept for symmetry).
	 * @param array<int, array{id:string,name:string,start:int,duration:int}> $clips Clips.
	 * @param array<string, bool>  $file_ids Used file ids.
	 * @param string               $prefix   Track prefix.
	 */
	private static function premiere_audio_track(
		DOMDocument $dom,
		array $timeline,
		array $clips,
		array &$file_ids,
		string $prefix
	): DOMElement {
		unset( $timeline );
		$track = $dom->createElement( 'track' );
		$n     = 0;
		foreach ( $clips as $clip ) {
			++$n;
			$clip_id = $prefix . '-clip-' . $n;
			$file_id = $prefix . '-file-' . $n;
			$file_ids[ $file_id ] = true;

			$item = $dom->createElement( 'clipitem' );
			$item->setAttribute( 'id', $clip_id );
			$track->appendChild( $item );

			self::append_text( $dom, $item, 'name', (string) $clip['name'] );
			self::append_text( $dom, $item, 'enabled', 'TRUE' );
			self::append_text( $dom, $item, 'duration', (string) (int) $clip['duration'] );
			$item->appendChild( self::premiere_rate( $dom ) );
			self::append_text( $dom, $item, 'start', (string) (int) $clip['start'] );
			self::append_text( $dom, $item, 'end', (string) ( (int) $clip['start'] + (int) $clip['duration'] ) );
			self::append_text( $dom, $item, 'in', '0' );
			self::append_text( $dom, $item, 'out', (string) (int) $clip['duration'] );

			$file = $dom->createElement( 'file' );
			$file->setAttribute( 'id', $file_id );
			$item->appendChild( $file );
			self::append_text( $dom, $file, 'name', (string) $clip['name'] );
			self::append_text( $dom, $file, 'pathurl', 'file://localhost/storyboards/placeholder.wav' );
			$file->appendChild( self::premiere_rate( $dom ) );
			self::append_text( $dom, $file, 'duration', (string) (int) $clip['duration'] );

			$fmedia = $dom->createElement( 'media' );
			$file->appendChild( $fmedia );
			$faudio = $dom->createElement( 'audio' );
			$fmedia->appendChild( $faudio );
			$sch = $dom->createElement( 'samplecharacteristics' );
			$faudio->appendChild( $sch );
			self::append_text( $dom, $sch, 'depth', '16' );
			self::append_text( $dom, $sch, 'samplerate', '48000' );
			self::append_text( $dom, $faudio, 'channelcount', '1' );

			$src = $dom->createElement( 'sourcetrack' );
			$item->appendChild( $src );
			self::append_text( $dom, $src, 'mediatype', 'audio' );
			self::append_text( $dom, $src, 'trackindex', '1' );
		}

		self::append_text( $dom, $track, 'enabled', 'TRUE' );
		self::append_text( $dom, $track, 'locked', 'FALSE' );
		return $track;
	}

	private static function premiere_rate( DOMDocument $dom ): DOMElement {
		$rate = $dom->createElement( 'rate' );
		self::append_text( $dom, $rate, 'timebase', (string) self::FPS );
		self::append_text( $dom, $rate, 'ntsc', 'FALSE' );
		return $rate;
	}

	/**
	 * Still / photo asset. Duration must be 0s; format must omit frameDuration.
	 */
	private static function fcpxml_still_asset(
		DOMDocument $dom,
		string $id,
		string $format_id,
		string $name,
		string $src = ''
	): DOMElement {
		$asset = $dom->createElement( 'asset' );
		$asset->setAttribute( 'id', $id );
		$asset->setAttribute( 'name', $name );
		$asset->setAttribute( 'start', '0s' );
		$asset->setAttribute( 'duration', '0s' );
		$asset->setAttribute( 'hasVideo', '1' );
		$asset->setAttribute( 'hasAudio', '0' );
		$asset->setAttribute( 'format', $format_id );

		$rep = $dom->createElement( 'media-rep' );
		$rep->setAttribute( 'kind', 'original-media' );
		$rep->setAttribute( 'src', '' !== $src ? $src : 'file:///storyboards/placeholder.mov' );
		$asset->appendChild( $rep );

		return $asset;
	}

	private static function fcpxml_audio_asset(
		DOMDocument $dom,
		string $id,
		string $name,
		int $duration_frames,
		string $src = ''
	): DOMElement {
		$asset = $dom->createElement( 'asset' );
		$asset->setAttribute( 'id', $id );
		$asset->setAttribute( 'name', $name );
		$asset->setAttribute( 'start', '0s' );
		$asset->setAttribute( 'duration', self::fcpxml_time( $duration_frames ) );
		$asset->setAttribute( 'hasVideo', '0' );
		$asset->setAttribute( 'hasAudio', '1' );
		$asset->setAttribute( 'audioSources', '1' );
		$asset->setAttribute( 'audioChannels', '1' );
		$asset->setAttribute( 'audioRate', '48000' );

		$rep = $dom->createElement( 'media-rep' );
		$rep->setAttribute( 'kind', 'original-media' );
		$rep->setAttribute( 'src', '' !== $src ? $src : 'file:///storyboards/placeholder.wav' );
		$asset->appendChild( $rep );

		return $asset;
	}

	/**
	 * ZIP package: folder with FCPXML + Media/ (oriented JPEGs + audio files).
	 *
	 * @param array<string, mixed>             $timeline Timeline.
	 * @param array<int, array<string, mixed>> $scenes   Scenes (unused; ids on timeline).
	 * @param array<int, array<string, mixed>> $audio    Audio (unused; ids on timeline).
	 * @param string                           $slug     Filename slug.
	 * @return array{body:string,filename:string,mime:string}|WP_Error
	 */
	private static function build_fcp_media_zip( array $timeline, array $scenes, array $audio, string $slug ): array|WP_Error {
		unset( $scenes, $audio );

		if ( ! class_exists( 'ZipArchive' ) ) {
			return new WP_Error(
				'storyboards_export_zip',
				__( 'ZIP support is not available on this server.', 'storyboards' ),
				array( 'status' => 500 )
			);
		}

		// tempnam() — do not use wp_tempnam(); it lives in wp-admin and is unavailable in REST.
		$tmp = tempnam( sys_get_temp_dir(), 'sbfcp' );
		if ( ! is_string( $tmp ) || '' === $tmp ) {
			return new WP_Error(
				'storyboards_export_tmp',
				__( 'Could not create a temporary export file.', 'storyboards' ),
				array( 'status' => 500 )
			);
		}
		$zip_path = $tmp . '.zip';
		@unlink( $tmp );

		$work = trailingslashit( sys_get_temp_dir() ) . 'sb-fcp-' . wp_generate_password( 8, false );
		if ( ! wp_mkdir_p( $work . '/Media' ) ) {
			return new WP_Error(
				'storyboards_export_tmp',
				__( 'Could not create a temporary export folder.', 'storyboards' ),
				array( 'status' => 500 )
			);
		}

		$media_map = array();
		$width     = (int) $timeline['width'];
		$height    = (int) $timeline['height'];

		foreach ( array( 'v1', 'v2' ) as $lane ) {
			foreach ( (array) $timeline[ $lane ] as $clip ) {
				$cid  = (string) $clip['id'];
				$file = $cid . '.jpg';
				$dest = $work . '/Media/' . $file;
				$ok   = false;
				$aid  = (int) ( $clip['attachment_id'] ?? 0 );
				if ( $aid > 0 ) {
					$ok = self::write_oriented_jpeg( $aid, $dest );
				}
				if ( ! $ok ) {
					self::write_slate_jpeg( $dest, (string) $clip['name'], $width, $height );
				}
				$media_map[ $cid ] = array(
					'src'       => 'Media/' . $file,
					'has_video' => true,
					'has_audio' => false,
				);
			}
		}

		foreach ( array( 'a1', 'a2' ) as $lane ) {
			foreach ( (array) $timeline[ $lane ] as $clip ) {
				$cid  = (string) $clip['id'];
				$aid  = (int) ( $clip['attachment_id'] ?? 0 );
				$secs = max( 1, (int) round( (int) $clip['duration'] / self::FPS ) );
				$file = self::export_audio_for_fcp( $aid, $work . '/Media', $cid, $secs );
				$media_map[ $cid ] = array(
					'src'       => 'Media/' . $file,
					'has_video' => false,
					'has_audio' => true,
				);
			}
		}

		$xml = self::to_fcpxml( $timeline, $media_map );
		$xml_name = $slug . '.fcpxml';
		file_put_contents( $work . '/' . $xml_name, $xml );

		$readme = "Storyboards → Final Cut Pro\n\n"
			. "1. Unzip this archive.\n"
			. "2. Keep the Media folder next to {$xml_name}.\n"
			. "3. In Final Cut Pro: File → Import → Media… and choose {$xml_name}.\n"
			. "4. Stills are JPEG with orientation baked in.\n"
			. "5. Audio is WAV/M4A/MP3 (browser WebM is converted to WAV on download).\n";
		file_put_contents( $work . '/README.txt', $readme );

		$zip = new ZipArchive();
		if ( true !== $zip->open( $zip_path, ZipArchive::CREATE | ZipArchive::OVERWRITE ) ) {
			self::rrmdir( $work );
			return new WP_Error(
				'storyboards_export_zip',
				__( 'Could not create the export ZIP.', 'storyboards' ),
				array( 'status' => 500 )
			);
		}

		$root = $slug . '-fcpx';
		self::zip_add_dir( $zip, $work, $root );
		$zip->close();

		$body = file_get_contents( $zip_path );
		@unlink( $zip_path );
		self::rrmdir( $work );

		if ( ! is_string( $body ) || '' === $body ) {
			return new WP_Error(
				'storyboards_export_zip',
				__( 'Could not read the export ZIP.', 'storyboards' ),
				array( 'status' => 500 )
			);
		}

		return array(
			'body'     => $body,
			'filename' => $slug . '-fcpx.zip',
			'mime'     => 'application/zip',
		);
	}

	/**
	 * Write JPEG with EXIF orientation baked into pixels.
	 */
	private static function write_oriented_jpeg( int $attachment_id, string $dest ): bool {
		$file = get_attached_file( $attachment_id );
		if ( ! is_string( $file ) || '' === $file || ! is_readable( $file ) ) {
			return false;
		}

		$editor = wp_get_image_editor( $file );
		if ( is_wp_error( $editor ) ) {
			return false;
		}

		self::apply_exif_orientation( $editor, $file );

		$size = $editor->get_size();
		if ( is_array( $size ) ) {
			$w = (int) ( $size['width'] ?? 0 );
			$h = (int) ( $size['height'] ?? 0 );
			$max_edge = 1920;
			if ( $w > 0 && $h > 0 && max( $w, $h ) > $max_edge ) {
				if ( $w >= $h ) {
					$editor->resize( $max_edge, null, false );
				} else {
					$editor->resize( null, $max_edge, false );
				}
			}
		}

		$editor->set_quality( 92 );
		$saved = $editor->save( $dest, 'image/jpeg' );
		return ! is_wp_error( $saved ) && is_readable( $dest );
	}

	/**
	 * @param WP_Image_Editor $editor Editor.
	 * @param string          $file   Source path.
	 */
	private static function apply_exif_orientation( $editor, string $file ): void {
		if ( ! function_exists( 'exif_read_data' ) ) {
			return;
		}
		$ext = strtolower( pathinfo( $file, PATHINFO_EXTENSION ) );
		if ( ! in_array( $ext, array( 'jpg', 'jpeg', 'tif', 'tiff' ), true ) ) {
			return;
		}

		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		$exif = @exif_read_data( $file );
		if ( ! is_array( $exif ) || empty( $exif['Orientation'] ) ) {
			return;
		}

		$orientation = (int) $exif['Orientation'];
		// WP_Image_Editor::rotate() is counter-clockwise.
		switch ( $orientation ) {
			case 3:
				$editor->rotate( 180 );
				break;
			case 6:
				$editor->rotate( 270 ); // 90° CW
				break;
			case 8:
				$editor->rotate( 90 ); // 90° CCW
				break;
			default:
				break;
		}
	}

	private static function write_slate_jpeg( string $dest, string $label, int $width, int $height ): bool {
		$width  = max( 320, min( 1920, $width ) );
		$height = max( 320, min( 1920, $height ) );
		if ( ! function_exists( 'imagecreatetruecolor' ) ) {
			return false;
		}
		$im = imagecreatetruecolor( $width, $height );
		if ( false === $im ) {
			return false;
		}
		$bg = imagecolorallocate( $im, 28, 28, 30 );
		$fg = imagecolorallocate( $im, 220, 220, 220 );
		imagefilledrectangle( $im, 0, 0, $width, $height, $bg );
		$text = self::latin1_clip( $label, 48 );
		$x    = 24;
		$y    = (int) max( 24, $height / 2 - 7 );
		imagestring( $im, 5, $x, $y, $text, $fg );
		$ok = imagejpeg( $im, $dest, 90 );
		imagedestroy( $im );
		return (bool) $ok;
	}

	private static function latin1_clip( string $text, int $max ): string {
		$ascii = preg_replace( '/[^\x20-\x7E]/', '?', $text );
		if ( ! is_string( $ascii ) || '' === $ascii ) {
			$ascii = 'Scene';
		}
		return substr( $ascii, 0, $max );
	}

	/**
	 * Export one audio clip for FCP. Incompatible formats (webm/ogg) become WAV
	 * (silent stub) plus Media/_source/ for browser re-encode on download.
	 *
	 * @return string Basename inside Media/ referenced by FCPXML.
	 */
	private static function export_audio_for_fcp( int $attachment_id, string $media_dir, string $clip_id, int $seconds ): string {
		$wav_name = $clip_id . '.wav';
		$seconds  = max( 1, $seconds );

		if ( $attachment_id < 1 ) {
			self::write_silent_wav( trailingslashit( $media_dir ) . $wav_name, $seconds );
			return $wav_name;
		}

		$file = get_attached_file( $attachment_id );
		if ( ! is_string( $file ) || '' === $file || ! is_readable( $file ) ) {
			self::write_silent_wav( trailingslashit( $media_dir ) . $wav_name, $seconds );
			return $wav_name;
		}

		$ext  = strtolower( pathinfo( $file, PATHINFO_EXTENSION ) );
		$mime = (string) get_post_mime_type( $attachment_id );
		if ( '' === $ext ) {
			if ( str_contains( $mime, 'mp4' ) || str_contains( $mime, 'm4a' ) || str_contains( $mime, 'aac' ) ) {
				$ext = 'm4a';
			} elseif ( str_contains( $mime, 'mpeg' ) || str_contains( $mime, 'mp3' ) ) {
				$ext = 'mp3';
			} elseif ( str_contains( $mime, 'wav' ) ) {
				$ext = 'wav';
			} elseif ( str_contains( $mime, 'ogg' ) ) {
				$ext = 'ogg';
			} elseif ( str_contains( $mime, 'aiff' ) || str_contains( $mime, 'aif' ) ) {
				$ext = 'aiff';
			} else {
				$ext = 'webm';
			}
		}

		$compatible = in_array( $ext, array( 'wav', 'mp3', 'm4a', 'aac', 'aif', 'aiff', 'caf' ), true );

		if ( $compatible ) {
			$basename = $clip_id . '.' . $ext;
			$dest     = trailingslashit( $media_dir ) . $basename;
			if ( copy( $file, $dest ) ) {
				return $basename;
			}
			self::write_silent_wav( trailingslashit( $media_dir ) . $wav_name, $seconds );
			return $wav_name;
		}

		// WebM/Ogg etc. — FCP cannot import these. Ship WAV + source for client transcode.
		self::write_silent_wav( trailingslashit( $media_dir ) . $wav_name, $seconds );
		$source_dir = trailingslashit( $media_dir ) . '_source';
		if ( ! is_dir( $source_dir ) ) {
			wp_mkdir_p( $source_dir );
		}
		@copy( $file, trailingslashit( $source_dir ) . $clip_id . '.' . $ext );
		return $wav_name;
	}

	/**
	 * Minimal silent PCM WAV so FCP always has an audio file to link.
	 */
	private static function write_silent_wav( string $dest, int $seconds ): void {
		$seconds     = max( 1, min( 60, $seconds ) );
		$sample_rate = 48000;
		$channels    = 1;
		$bits        = 16;
		$data_size   = (int) ( $seconds * $sample_rate * $channels * ( $bits / 8 ) );
		$byte_rate   = (int) ( $sample_rate * $channels * ( $bits / 8 ) );
		$block_align = (int) ( $channels * ( $bits / 8 ) );

		$header  = 'RIFF';
		$header .= pack( 'V', 36 + $data_size );
		$header .= 'WAVE';
		$header .= 'fmt ';
		$header .= pack( 'V', 16 );
		$header .= pack( 'v', 1 );
		$header .= pack( 'v', $channels );
		$header .= pack( 'V', $sample_rate );
		$header .= pack( 'V', $byte_rate );
		$header .= pack( 'v', $block_align );
		$header .= pack( 'v', $bits );
		$header .= 'data';
		$header .= pack( 'V', $data_size );

		file_put_contents( $dest, $header . str_repeat( "\0", $data_size ) );
	}

	/**
	 * @param ZipArchive $zip   Zip.
	 * @param string     $dir   Absolute dir.
	 * @param string     $local Local path prefix inside zip.
	 */
	private static function zip_add_dir( ZipArchive $zip, string $dir, string $local ): void {
		$files = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ),
			RecursiveIteratorIterator::SELF_FIRST
		);
		foreach ( $files as $file ) {
			$path = $file->getPathname();
			$rel  = substr( $path, strlen( $dir ) + 1 );
			$rel  = str_replace( '\\', '/', (string) $rel );
			$name = trim( $local . '/' . $rel, '/' );
			if ( $file->isDir() ) {
				$zip->addEmptyDir( $name );
			} else {
				$zip->addFile( $path, $name );
			}
		}
	}

	private static function rrmdir( string $dir ): void {
		if ( ! is_dir( $dir ) ) {
			return;
		}
		$items = scandir( $dir );
		if ( ! is_array( $items ) ) {
			return;
		}
		foreach ( $items as $item ) {
			if ( '.' === $item || '..' === $item ) {
				continue;
			}
			$path = $dir . '/' . $item;
			if ( is_dir( $path ) ) {
				self::rrmdir( $path );
			} else {
				@unlink( $path );
			}
		}
		@rmdir( $dir );
	}

	/**
	 * Still on timeline. Must be <video>, never <asset-clip> (FCP SIGABRT).
	 *
	 * @param int|null $lane Null = primary storyline (no lane attr).
	 */
	private static function fcpxml_video_clip(
		DOMDocument $dom,
		string $ref,
		string $name,
		int $offset_frames,
		int $duration_frames,
		?int $lane
	): DOMElement {
		$el = $dom->createElement( 'video' );
		$el->setAttribute( 'ref', $ref );
		$el->setAttribute( 'name', $name );
		if ( null !== $lane ) {
			$el->setAttribute( 'lane', (string) $lane );
		}
		$el->setAttribute( 'offset', self::fcpxml_time( $offset_frames ) );
		$el->setAttribute( 'duration', self::fcpxml_time( $duration_frames ) );
		$el->setAttribute( 'start', '0s' );
		return $el;
	}

	/** Audio connected clip — asset-clip with srcEnable="audio" is valid. */
	private static function fcpxml_audio_clip(
		DOMDocument $dom,
		string $ref,
		string $name,
		int $offset_frames,
		int $duration_frames,
		int $lane
	): DOMElement {
		$el = $dom->createElement( 'asset-clip' );
		$el->setAttribute( 'ref', $ref );
		$el->setAttribute( 'name', $name );
		$el->setAttribute( 'lane', (string) $lane );
		$el->setAttribute( 'offset', self::fcpxml_time( $offset_frames ) );
		$el->setAttribute( 'duration', self::fcpxml_time( $duration_frames ) );
		$el->setAttribute( 'start', '0s' );
		$el->setAttribute( 'srcEnable', 'audio' );
		return $el;
	}

	private static function append_text( DOMDocument $dom, DOMElement $parent, string $name, string $value ): void {
		$el = $dom->createElement( $name );
		$el->appendChild( $dom->createTextNode( $value ) );
		$parent->appendChild( $el );
	}
}
