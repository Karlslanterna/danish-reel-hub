export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      analytics_events: {
        Row: {
          created_at: string
          event_type: string
          filter_name: string | null
          filter_value: string | null
          id: number
          is_active: boolean | null
          item_id: string | null
          item_type: string | null
          path: string
        }
        Insert: {
          created_at?: string
          event_type: string
          filter_name?: string | null
          filter_value?: string | null
          id?: number
          is_active?: boolean | null
          item_id?: string | null
          item_type?: string | null
          path: string
        }
        Update: {
          created_at?: string
          event_type?: string
          filter_name?: string | null
          filter_value?: string | null
          id?: number
          is_active?: boolean | null
          item_id?: string | null
          item_type?: string | null
          path?: string
        }
        Relationships: []
      }
      cinemas: {
        Row: {
          address: string
          city: string
          created_at: string
          description: string
          ebillet_organizer_id: number | null
          external_id: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          screens: number
          slug: string
          source: string
          website: string | null
        }
        Insert: {
          address: string
          city: string
          created_at?: string
          description: string
          ebillet_organizer_id?: number | null
          external_id?: string | null
          id: string
          latitude?: number | null
          longitude?: number | null
          name: string
          screens: number
          slug: string
          source?: string
          website?: string | null
        }
        Update: {
          address?: string
          city?: string
          created_at?: string
          description?: string
          ebillet_organizer_id?: number | null
          external_id?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          screens?: number
          slug?: string
          source?: string
          website?: string | null
        }
        Relationships: []
      }
      ebillet_organizers: {
        Row: {
          address: string | null
          cinema_id: string | null
          city: string | null
          created_at: string
          discovered_at: string
          id: number
          is_active: boolean
          last_sync_counts: Json
          last_sync_error: string | null
          last_sync_status: string | null
          last_synced_at: string | null
          location_count: number
          name: string
          region: string | null
          showtime_count: number
          updated_at: string
          zip: string | null
        }
        Insert: {
          address?: string | null
          cinema_id?: string | null
          city?: string | null
          created_at?: string
          discovered_at?: string
          id: number
          is_active?: boolean
          last_sync_counts?: Json
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          location_count?: number
          name: string
          region?: string | null
          showtime_count?: number
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address?: string | null
          cinema_id?: string | null
          city?: string | null
          created_at?: string
          discovered_at?: string
          id?: number
          is_active?: boolean
          last_sync_counts?: Json
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          location_count?: number
          name?: string
          region?: string | null
          showtime_count?: number
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ebillet_organizers_cinema_id_fkey"
            columns: ["cinema_id"]
            isOneToOne: false
            referencedRelation: "cinemas"
            referencedColumns: ["id"]
          },
        ]
      }
      ebillet_sync_runs: {
        Row: {
          cinemas_upserted: number
          created_at: string
          cursor: number
          duration_seconds: number | null
          errors: Json
          finished_at: string | null
          id: string
          kind: string
          message: string | null
          movies_upserted: number
          organizers_active: number
          organizers_failed: number
          organizers_found: number
          organizers_synced: number
          showtimes_upserted: number
          started_at: string
          status: string
          trigger: string
          updated_at: string
        }
        Insert: {
          cinemas_upserted?: number
          created_at?: string
          cursor?: number
          duration_seconds?: number | null
          errors?: Json
          finished_at?: string | null
          id?: string
          kind?: string
          message?: string | null
          movies_upserted?: number
          organizers_active?: number
          organizers_failed?: number
          organizers_found?: number
          organizers_synced?: number
          showtimes_upserted?: number
          started_at?: string
          status?: string
          trigger?: string
          updated_at?: string
        }
        Update: {
          cinemas_upserted?: number
          created_at?: string
          cursor?: number
          duration_seconds?: number | null
          errors?: Json
          finished_at?: string | null
          id?: string
          kind?: string
          message?: string | null
          movies_upserted?: number
          organizers_active?: number
          organizers_failed?: number
          organizers_found?: number
          organizers_synced?: number
          showtimes_upserted?: number
          started_at?: string
          status?: string
          trigger?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_health_events: {
        Row: {
          created_at: string
          id: string
          job_id: string | null
          metrics: Json
          previous_status: string | null
          reasons: string[]
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id?: string | null
          metrics?: Json
          previous_status?: string | null
          reasons?: string[]
          status: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string | null
          metrics?: Json
          previous_status?: string | null
          reasons?: string[]
          status?: string
        }
        Relationships: []
      }
      import_jobs: {
        Row: {
          created_at: string
          cursor: number
          errors: string[]
          id: string
          message: string | null
          payload: Json | null
          phase: string
          processed_cinemas: number
          processed_movies: number
          processed_showtimes: number
          source: string
          status: string
          total_cinemas: number
          total_movies: number
          total_showtimes: number
          updated_at: string
          xml: string
        }
        Insert: {
          created_at?: string
          cursor?: number
          errors?: string[]
          id?: string
          message?: string | null
          payload?: Json | null
          phase?: string
          processed_cinemas?: number
          processed_movies?: number
          processed_showtimes?: number
          source?: string
          status?: string
          total_cinemas?: number
          total_movies?: number
          total_showtimes?: number
          updated_at?: string
          xml: string
        }
        Update: {
          created_at?: string
          cursor?: number
          errors?: string[]
          id?: string
          message?: string | null
          payload?: Json | null
          phase?: string
          processed_cinemas?: number
          processed_movies?: number
          processed_showtimes?: number
          source?: string
          status?: string
          total_cinemas?: number
          total_movies?: number
          total_showtimes?: number
          updated_at?: string
          xml?: string
        }
        Relationships: []
      }
      import_runs: {
        Row: {
          attempts: number
          created_at: string
          cursor: Json | null
          finished_at: string | null
          id: string
          last_error: string | null
          last_heartbeat: string | null
          lease_until: string | null
          scope_key: string
          scope_type: string
          snapshot_id: string | null
          source: string
          state: string
          stats: Json
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          cursor?: Json | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          last_heartbeat?: string | null
          lease_until?: string | null
          scope_key: string
          scope_type: string
          snapshot_id?: string | null
          source: string
          state?: string
          stats?: Json
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          cursor?: Json | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          last_heartbeat?: string | null
          lease_until?: string | null
          scope_key?: string
          scope_type?: string
          snapshot_id?: string | null
          source?: string
          state?: string
          stats?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_runs_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      import_schedule_runs: {
        Row: {
          attempts: number
          created_at: string
          duration_seconds: number | null
          finished_at: string | null
          id: string
          job_id: string | null
          reason: string | null
          started_at: string
          status: string
          trigger: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          duration_seconds?: number | null
          finished_at?: string | null
          id?: string
          job_id?: string | null
          reason?: string | null
          started_at?: string
          status?: string
          trigger?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          duration_seconds?: number | null
          finished_at?: string | null
          id?: string
          job_id?: string | null
          reason?: string | null
          started_at?: string
          status?: string
          trigger?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_snapshots: {
        Row: {
          created_at: string
          fetched_at: string
          id: string
          payload_hash: string
          raw_payload: string | null
          scope_external_id: string | null
          scope_type: string
          source: string
          status: string
          updated_at: string
          validation: Json
        }
        Insert: {
          created_at?: string
          fetched_at?: string
          id?: string
          payload_hash: string
          raw_payload?: string | null
          scope_external_id?: string | null
          scope_type: string
          source: string
          status?: string
          updated_at?: string
          validation?: Json
        }
        Update: {
          created_at?: string
          fetched_at?: string
          id?: string
          payload_hash?: string
          raw_payload?: string | null
          scope_external_id?: string | null
          scope_type?: string
          source?: string
          status?: string
          updated_at?: string
          validation?: Json
        }
        Relationships: []
      }
      movies: {
        Row: {
          created_at: string
          director: string
          ebillet_movie_base_id: number | null
          ebillet_movie_ids: number[]
          external_id: string | null
          genre: string[]
          id: string
          original_title: string | null
          poster: Json
          rating: string
          release_date: string | null
          runtime: number
          slug: string
          source: string
          synopsis: string
          title: string
          tmdb_backdrop_url: string | null
          tmdb_cast: Json
          tmdb_director: string | null
          tmdb_fetched_at: string | null
          tmdb_genres: string[]
          tmdb_id: number | null
          tmdb_overview: string | null
          tmdb_poster_url: string | null
          tmdb_runtime: number | null
          tmdb_skip_reason: string | null
          tmdb_status: string
          tmdb_trailer_url: string | null
          tmdb_vote_average: number | null
          trailer_url: string | null
          year: number
        }
        Insert: {
          created_at?: string
          director: string
          ebillet_movie_base_id?: number | null
          ebillet_movie_ids?: number[]
          external_id?: string | null
          genre?: string[]
          id: string
          original_title?: string | null
          poster?: Json
          rating: string
          release_date?: string | null
          runtime: number
          slug: string
          source?: string
          synopsis: string
          title: string
          tmdb_backdrop_url?: string | null
          tmdb_cast?: Json
          tmdb_director?: string | null
          tmdb_fetched_at?: string | null
          tmdb_genres?: string[]
          tmdb_id?: number | null
          tmdb_overview?: string | null
          tmdb_poster_url?: string | null
          tmdb_runtime?: number | null
          tmdb_skip_reason?: string | null
          tmdb_status?: string
          tmdb_trailer_url?: string | null
          tmdb_vote_average?: number | null
          trailer_url?: string | null
          year: number
        }
        Update: {
          created_at?: string
          director?: string
          ebillet_movie_base_id?: number | null
          ebillet_movie_ids?: number[]
          external_id?: string | null
          genre?: string[]
          id?: string
          original_title?: string | null
          poster?: Json
          rating?: string
          release_date?: string | null
          runtime?: number
          slug?: string
          source?: string
          synopsis?: string
          title?: string
          tmdb_backdrop_url?: string | null
          tmdb_cast?: Json
          tmdb_director?: string | null
          tmdb_fetched_at?: string | null
          tmdb_genres?: string[]
          tmdb_id?: number | null
          tmdb_overview?: string | null
          tmdb_poster_url?: string | null
          tmdb_runtime?: number | null
          tmdb_skip_reason?: string | null
          tmdb_status?: string
          tmdb_trailer_url?: string | null
          tmdb_vote_average?: number | null
          trailer_url?: string | null
          year?: number
        }
        Relationships: []
      }
      scheduler_secrets: {
        Row: {
          created_at: string
          name: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          name: string
          updated_at?: string
          value?: string
        }
        Update: {
          created_at?: string
          name?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      screening_event_overrides: {
        Row: {
          action: string
          active: boolean
          created_at: string
          created_by: string | null
          event: string
          id: string
          note: string
          source: string
          source_ref: string
          updated_at: string
        }
        Insert: {
          action: string
          active?: boolean
          created_at?: string
          created_by?: string | null
          event: string
          id?: string
          note: string
          source: string
          source_ref: string
          updated_at?: string
        }
        Update: {
          action?: string
          active?: boolean
          created_at?: string
          created_by?: string | null
          event?: string
          id?: string
          note?: string
          source?: string
          source_ref?: string
          updated_at?: string
        }
        Relationships: []
      }
      screenings: {
        Row: {
          cinema_id: string
          created_at: string
          events: string[]
          formats: string[]
          free_seats: number | null
          hall: string
          id: string
          languages: string[]
          local_date: string
          local_time: string
          movie_id: string
          price_max: number | null
          price_min: number | null
          snapshot_id: string | null
          source: string
          source_ref: string
          starts_at: string
          ticket_url: string | null
          updated_at: string
        }
        Insert: {
          cinema_id: string
          created_at?: string
          events?: string[]
          formats?: string[]
          free_seats?: number | null
          hall?: string
          id?: string
          languages?: string[]
          local_date: string
          local_time: string
          movie_id: string
          price_max?: number | null
          price_min?: number | null
          snapshot_id?: string | null
          source: string
          source_ref: string
          starts_at: string
          ticket_url?: string | null
          updated_at?: string
        }
        Update: {
          cinema_id?: string
          created_at?: string
          events?: string[]
          formats?: string[]
          free_seats?: number | null
          hall?: string
          id?: string
          languages?: string[]
          local_date?: string
          local_time?: string
          movie_id?: string
          price_max?: number | null
          price_min?: number | null
          snapshot_id?: string | null
          source?: string
          source_ref?: string
          starts_at?: string
          ticket_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "screenings_cinema_id_fkey"
            columns: ["cinema_id"]
            isOneToOne: false
            referencedRelation: "cinemas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screenings_movie_id_fkey"
            columns: ["movie_id"]
            isOneToOne: false
            referencedRelation: "movies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screenings_movie_id_fkey"
            columns: ["movie_id"]
            isOneToOne: false
            referencedRelation: "movies_ranked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screenings_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      showtimes: {
        Row: {
          booking_url: string | null
          cinema_id: string
          created_at: string
          date: string
          ebillet_showtime_ids: number[]
          events: string[]
          external_id: string | null
          formats: string[]
          free_seats: number | null
          hall: string
          id: string
          languages: string[]
          max_price: number | null
          min_price: number | null
          movie_id: string
          source: string
          start_time: string | null
          ticket_url: string | null
          ticket_urls: string[]
          times: string[]
        }
        Insert: {
          booking_url?: string | null
          cinema_id: string
          created_at?: string
          date: string
          ebillet_showtime_ids?: number[]
          events?: string[]
          external_id?: string | null
          formats?: string[]
          free_seats?: number | null
          hall: string
          id?: string
          languages?: string[]
          max_price?: number | null
          min_price?: number | null
          movie_id: string
          source?: string
          start_time?: string | null
          ticket_url?: string | null
          ticket_urls?: string[]
          times?: string[]
        }
        Update: {
          booking_url?: string | null
          cinema_id?: string
          created_at?: string
          date?: string
          ebillet_showtime_ids?: number[]
          events?: string[]
          external_id?: string | null
          formats?: string[]
          free_seats?: number | null
          hall?: string
          id?: string
          languages?: string[]
          max_price?: number | null
          min_price?: number | null
          movie_id?: string
          source?: string
          start_time?: string | null
          ticket_url?: string | null
          ticket_urls?: string[]
          times?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "showtimes_cinema_id_fkey"
            columns: ["cinema_id"]
            isOneToOne: false
            referencedRelation: "cinemas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showtimes_movie_id_fkey"
            columns: ["movie_id"]
            isOneToOne: false
            referencedRelation: "movies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showtimes_movie_id_fkey"
            columns: ["movie_id"]
            isOneToOne: false
            referencedRelation: "movies_ranked"
            referencedColumns: ["id"]
          },
        ]
      }
      source_entity_refs: {
        Row: {
          canonical_id: string
          confidence: number | null
          created_at: string
          entity_type: string
          external_id: string
          id: string
          locked: boolean
          match_method: string
          notes: string | null
          source: string
          updated_at: string
        }
        Insert: {
          canonical_id: string
          confidence?: number | null
          created_at?: string
          entity_type: string
          external_id: string
          id?: string
          locked?: boolean
          match_method: string
          notes?: string | null
          source: string
          updated_at?: string
        }
        Update: {
          canonical_id?: string
          confidence?: number | null
          created_at?: string
          entity_type?: string
          external_id?: string
          id?: string
          locked?: boolean
          match_method?: string
          notes?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      staged_screenings: {
        Row: {
          created_at: string
          events: string[]
          formats: string[]
          free_seats: number | null
          hall: string
          id: string
          languages: string[]
          local_date: string
          local_time: string
          price_max: number | null
          price_min: number | null
          snapshot_id: string
          source: string
          source_cinema_ref: string
          source_movie_ref: string
          source_ref: string
          starts_at: string
          ticket_url: string | null
        }
        Insert: {
          created_at?: string
          events?: string[]
          formats?: string[]
          free_seats?: number | null
          hall?: string
          id?: string
          languages?: string[]
          local_date: string
          local_time: string
          price_max?: number | null
          price_min?: number | null
          snapshot_id: string
          source: string
          source_cinema_ref: string
          source_movie_ref: string
          source_ref: string
          starts_at: string
          ticket_url?: string | null
        }
        Update: {
          created_at?: string
          events?: string[]
          formats?: string[]
          free_seats?: number | null
          hall?: string
          id?: string
          languages?: string[]
          local_date?: string
          local_time?: string
          price_max?: number | null
          price_min?: number | null
          snapshot_id?: string
          source?: string
          source_cinema_ref?: string
          source_movie_ref?: string
          source_ref?: string
          starts_at?: string
          ticket_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staged_screenings_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "import_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      unresolved_source_entities: {
        Row: {
          candidates: Json
          context: Json
          created_at: string
          entity_type: string
          external_id: string
          id: string
          label: string
          resolved: boolean
          source: string
          updated_at: string
        }
        Insert: {
          candidates?: Json
          context?: Json
          created_at?: string
          entity_type: string
          external_id: string
          id?: string
          label: string
          resolved?: boolean
          source: string
          updated_at?: string
        }
        Update: {
          candidates?: Json
          context?: Json
          created_at?: string
          entity_type?: string
          external_id?: string
          id?: string
          label?: string
          resolved?: boolean
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      movies_ranked: {
        Row: {
          created_at: string | null
          director: string | null
          external_id: string | null
          genre: string[] | null
          id: string | null
          next_screening_date: string | null
          original_title: string | null
          poster: Json | null
          rating: string | null
          release_date: string | null
          runtime: number | null
          screening_count: number | null
          slug: string | null
          synopsis: string | null
          title: string | null
          tmdb_backdrop_url: string | null
          tmdb_cast: Json | null
          tmdb_director: string | null
          tmdb_fetched_at: string | null
          tmdb_genres: string[] | null
          tmdb_id: number | null
          tmdb_overview: string | null
          tmdb_poster_url: string | null
          tmdb_runtime: number | null
          tmdb_skip_reason: string | null
          tmdb_status: string | null
          tmdb_trailer_url: string | null
          tmdb_vote_average: number | null
          trailer_url: string | null
          year: number | null
        }
        Relationships: []
      }
      screening_model_parity: {
        Row: {
          canonical_count: number | null
          cinema_id: string | null
          delta: number | null
          legacy_count: number | null
          screening_date: string | null
          source: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_screening_event_overrides: {
        Args: { p_cinema_id: string; p_source: string }
        Returns: number
      }
      cinema_authoritative_source: {
        Args: { p_cinema_id: string }
        Returns: string
      }
      claim_import_run: {
        Args: { p_lease_seconds?: number; p_source: string }
        Returns: {
          attempts: number
          created_at: string
          cursor: Json | null
          finished_at: string | null
          id: string
          last_error: string | null
          last_heartbeat: string | null
          lease_until: string | null
          scope_key: string
          scope_type: string
          snapshot_id: string | null
          source: string
          state: string
          stats: Json
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "import_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_import_audit_data: {
        Args: {
          p_raw_payload_days?: number
          p_snapshot_metadata_days?: number
          p_staging_days?: number
        }
        Returns: Json
      }
      enqueue_ebillet_import_runs: { Args: never; Returns: number }
      get_public_showtime_index: {
        Args: {
          p_cinema_ids?: string[] | null
          p_first_date: string
          p_last_date: string
          p_starts_after: string
        }
        Returns: Json
      }
      get_movie_showtime_groups: {
        Args: {
          p_first_date: string
          p_last_date: string
          p_movie_ids: string[]
          p_starts_after: string
        }
        Returns: Json
      }
      get_movie_showtime_schedule: {
        Args: {
          p_first_date: string
          p_last_date: string
          p_movie_ids: string[]
          p_starts_after: string
        }
        Returns: Json
      }
      promote_screenings: {
        Args: {
          p_cinema_id: string
          p_rows: Json
          p_snapshot_id: string
          p_source: string
        }
        Returns: Json
      }
      purge_ebillet_non_cinema_scope: {
        Args: { p_organizer_id: number }
        Returns: Json
      }
      rebuild_showtimes_for_cinema: {
        Args: { p_cinema_id: string; p_source: string }
        Returns: number
      }
      slugify: { Args: { value: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
