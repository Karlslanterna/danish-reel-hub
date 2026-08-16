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
    }
    Functions: {
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
