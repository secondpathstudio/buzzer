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
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      buzzes: {
        Row: {
          buzzed_at: string
          participant_id: string
          position: number
          round_id: string
        }
        Insert: {
          buzzed_at?: string
          participant_id: string
          position: number
          round_id: string
        }
        Update: {
          buzzed_at?: string
          participant_id?: string
          position?: number
          round_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "buzzes_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buzzes_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      hosts: {
        Row: {
          created_at: string
          id: string
          payment_customer_id: string | null
          plan: string
          plan_expires_at: string | null
        }
        Insert: {
          created_at?: string
          id: string
          payment_customer_id?: string | null
          plan?: string
          plan_expires_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          payment_customer_id?: string | null
          plan?: string
          plan_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hosts_plan_fkey"
            columns: ["plan"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          display_name: string
          id: string
          joined_at: string
          room_id: string
          user_id: string
        }
        Insert: {
          display_name: string
          id?: string
          joined_at?: string
          room_id: string
          user_id: string
        }
        Update: {
          display_name?: string
          id?: string
          joined_at?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "participants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          id: string
          max_active_rooms: number
          max_participants: number
        }
        Insert: {
          id: string
          max_active_rooms: number
          max_participants: number
        }
        Update: {
          id?: string
          max_active_rooms?: number
          max_participants?: number
        }
        Relationships: []
      }
      purchases: {
        Row: {
          created_at: string
          host_id: string
          id: string
          kind: string
          max_participants: number
          provider_ref: string
          room_id: string | null
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          host_id: string
          id?: string
          kind: string
          max_participants: number
          provider_ref: string
          room_id?: string | null
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          host_id?: string
          id?: string
          kind?: string
          max_participants?: number
          provider_ref?: string
          room_id?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          code: string
          created_at: string
          current_round_id: string | null
          expires_at: string
          host_id: string
          id: string
          max_participants: number
          title: string | null
        }
        Insert: {
          code: string
          created_at?: string
          current_round_id?: string | null
          expires_at?: string
          host_id: string
          id?: string
          max_participants: number
          title?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          current_round_id?: string | null
          expires_at?: string
          host_id?: string
          id?: string
          max_participants?: number
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rooms_current_round_fk"
            columns: ["current_round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      rounds: {
        Row: {
          id: string
          locked_at: string | null
          number: number
          opened_at: string | null
          room_id: string
          status: string
          winner_id: string | null
        }
        Insert: {
          id?: string
          locked_at?: string | null
          number: number
          opened_at?: string | null
          room_id: string
          status?: string
          winner_id?: string | null
        }
        Update: {
          id?: string
          locked_at?: string | null
          number?: number
          opened_at?: string | null
          room_id?: string
          status?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rounds_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rounds_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      buzz: { Args: { p_round_id: string }; Returns: number }
      create_room: {
        Args: { p_title?: string }
        Returns: {
          code: string
          created_at: string
          current_round_id: string | null
          expires_at: string
          host_id: string
          id: string
          max_participants: number
          title: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      generate_room_code: { Args: never; Returns: string }
      is_room_host: { Args: { p_room_id: string }; Returns: boolean }
      is_room_member: { Args: { p_room_id: string }; Returns: boolean }
      join_room: {
        Args: { p_code: string; p_display_name: string }
        Returns: {
          display_name: string
          id: string
          joined_at: string
          room_id: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "participants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lock_round: {
        Args: { p_room_id: string }
        Returns: {
          id: string
          locked_at: string | null
          number: number
          opened_at: string | null
          room_id: string
          status: string
          winner_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rounds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      open_round: {
        Args: { p_room_id: string }
        Returns: {
          id: string
          locked_at: string | null
          number: number
          opened_at: string | null
          room_id: string
          status: string
          winner_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rounds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_participant: {
        Args: { p_participant_id: string }
        Returns: undefined
      }
      reset_round: {
        Args: { p_open?: boolean; p_room_id: string }
        Returns: {
          id: string
          locked_at: string | null
          number: number
          opened_at: string | null
          room_id: string
          status: string
          winner_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rounds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
