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
          external_id: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          screens: number
          slug: string
          website: string | null
        }
        Insert: {
          address: string
          city: string
          created_at?: string
          description: string
          external_id?: string | null
          id: string
          latitude?: number | null
          longitude?: number | null
          name: string
          screens: number
          slug: string
          website?: string | null
        }
        Update: {
          address?: string
          city?: string
          created_at?: string
          description?: string
          external_id?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          screens?: number
          slug?: string
          website?: string | null
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
      movies: {
        Row: {
          created_at: string
          director: string
          external_id: string | null
          genre: string[]
          id: string
          original_title: string | null
          poster: Json
          rating: string
          release_date: string | null
          runtime: number
          slug: string
          synopsis: string
          title: string
          trailer_url: string | null
          year: number
        }
        Insert: {
          created_at?: string
          director: string
          external_id?: string | null
          genre?: string[]
          id: string
          original_title?: string | null
          poster?: Json
          rating: string
          release_date?: string | null
          runtime: number
          slug: string
          synopsis: string
          title: string
          trailer_url?: string | null
          year: number
        }
        Update: {
          created_at?: string
          director?: string
          external_id?: string | null
          genre?: string[]
          id?: string
          original_title?: string | null
          poster?: Json
          rating?: string
          release_date?: string | null
          runtime?: number
          slug?: string
          synopsis?: string
          title?: string
          trailer_url?: string | null
          year?: number
        }
        Relationships: []
      }
      showtimes: {
        Row: {
          booking_url: string | null
          cinema_id: string
          created_at: string
          date: string
          external_id: string | null
          hall: string
          id: string
          movie_id: string
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
          external_id?: string | null
          hall: string
          id?: string
          movie_id: string
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
          external_id?: string | null
          hall?: string
          id?: string
          movie_id?: string
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
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
