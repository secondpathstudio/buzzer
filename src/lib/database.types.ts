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
      features: {
        Row: {
          key: string
          label: string
        }
        Insert: {
          key: string
          label: string
        }
        Update: {
          key?: string
          label?: string
        }
        Relationships: []
      }
      groups: {
        Row: {
          color: string
          created_at: string
          emoji: string | null
          id: string
          name: string
          reveal_media_id: string | null
          room_id: string
          sort_order: number
        }
        Insert: {
          color: string
          created_at?: string
          emoji?: string | null
          id?: string
          name: string
          reveal_media_id?: string | null
          room_id: string
          sort_order?: number
        }
        Update: {
          color?: string
          created_at?: string
          emoji?: string | null
          id?: string
          name?: string
          reveal_media_id?: string | null
          room_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "groups_reveal_media_id_fkey"
            columns: ["reveal_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
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
      media_assets: {
        Row: {
          bytes: number
          created_at: string
          duration_ms: number | null
          host_id: string
          id: string
          kind: string
          label: string | null
          mime_type: string
          storage_path: string
        }
        Insert: {
          bytes: number
          created_at?: string
          duration_ms?: number | null
          host_id: string
          id?: string
          kind: string
          label?: string | null
          mime_type: string
          storage_path: string
        }
        Update: {
          bytes?: number
          created_at?: string
          duration_ms?: number | null
          host_id?: string
          id?: string
          kind?: string
          label?: string | null
          mime_type?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          display_name: string
          group_id: string | null
          id: string
          joined_at: string
          room_id: string
          user_id: string
        }
        Insert: {
          display_name: string
          group_id?: string | null
          id?: string
          joined_at?: string
          room_id: string
          user_id: string
        }
        Update: {
          display_name?: string
          group_id?: string | null
          id?: string
          joined_at?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "participants_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_features: {
        Row: {
          feature_key: string
          plan_id: string
        }
        Insert: {
          feature_key: string
          plan_id: string
        }
        Update: {
          feature_key?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_features_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "plan_features_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          id: string
          max_active_rooms: number
          max_media_assets: number
          max_participants: number
        }
        Insert: {
          id: string
          max_active_rooms: number
          max_media_assets?: number
          max_participants: number
        }
        Update: {
          id?: string
          max_active_rooms?: number
          max_media_assets?: number
          max_participants?: number
        }
        Relationships: []
      }
      point_events: {
        Row: {
          created_at: string
          delta: number
          group_id: string | null
          id: string
          participant_id: string | null
          reason: string | null
          room_id: string
          round_id: string | null
          voided_at: string | null
        }
        Insert: {
          created_at?: string
          delta: number
          group_id?: string | null
          id?: string
          participant_id?: string | null
          reason?: string | null
          room_id: string
          round_id?: string | null
          voided_at?: string | null
        }
        Update: {
          created_at?: string
          delta?: number
          group_id?: string | null
          id?: string
          participant_id?: string | null
          reason?: string | null
          room_id?: string
          round_id?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "point_events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_events_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_events_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_events_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
        ]
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
      room_feature_grants: {
        Row: {
          created_at: string
          feature_key: string
          room_id: string
          source: string
        }
        Insert: {
          created_at?: string
          feature_key: string
          room_id: string
          source: string
        }
        Update: {
          created_at?: string
          feature_key?: string
          room_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_feature_grants_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "room_feature_grants_room_id_fkey"
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
          group_noun: string
          group_noun_plural: string
          groups_mode: string
          host_id: string
          id: string
          max_participants: number
          point_presets: number[]
          points_enabled: boolean
          reveal_intro_media_id: string | null
          sorting_text: string | null
          title: string | null
        }
        Insert: {
          code: string
          created_at?: string
          current_round_id?: string | null
          expires_at?: string
          group_noun?: string
          group_noun_plural?: string
          groups_mode?: string
          host_id: string
          id?: string
          max_participants: number
          point_presets?: number[]
          points_enabled?: boolean
          reveal_intro_media_id?: string | null
          sorting_text?: string | null
          title?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          current_round_id?: string | null
          expires_at?: string
          group_noun?: string
          group_noun_plural?: string
          groups_mode?: string
          host_id?: string
          id?: string
          max_participants?: number
          point_presets?: number[]
          points_enabled?: boolean
          reveal_intro_media_id?: string | null
          sorting_text?: string | null
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
          {
            foreignKeyName: "rooms_reveal_intro_media_id_fkey"
            columns: ["reveal_intro_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
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
      assign_unassigned: { Args: { p_room_id: string }; Returns: undefined }
      award_points: {
        Args: {
          p_delta: number
          p_group_id?: string
          p_participant_id?: string
          p_reason?: string
          p_room_id: string
          p_round_id?: string
        }
        Returns: {
          created_at: string
          delta: number
          group_id: string | null
          id: string
          participant_id: string | null
          reason: string | null
          room_id: string
          round_id: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "point_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      buzz: { Args: { p_round_id: string }; Returns: number }
      check_media_owner: {
        Args: { p_host_id: string; p_media_id: string }
        Returns: undefined
      }
      choose_group: {
        Args: { p_group_id: string }
        Returns: {
          display_name: string
          group_id: string | null
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
      create_room: {
        Args: { p_title?: string }
        Returns: {
          code: string
          created_at: string
          current_round_id: string | null
          expires_at: string
          group_noun: string
          group_noun_plural: string
          groups_mode: string
          host_id: string
          id: string
          max_participants: number
          point_presets: number[]
          points_enabled: boolean
          reveal_intro_media_id: string | null
          title: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_media_asset: { Args: { p_asset_id: string }; Returns: string }
      effective_plan: { Args: { p_host_id: string }; Returns: string }
      generate_room_code: { Args: never; Returns: string }
      get_join_info: { Args: { p_code: string }; Returns: Json }
      get_room_entitlements: { Args: { p_room_id: string }; Returns: Json }
      get_scoreboard: { Args: { p_room_id: string }; Returns: Json }
      host_has_feature: {
        Args: { p_feature: string; p_host_id: string }
        Returns: boolean
      }
      is_room_host: { Args: { p_room_id: string }; Returns: boolean }
      is_room_member: { Args: { p_room_id: string }; Returns: boolean }
      join_room: {
        Args: { p_code: string; p_display_name: string; p_group_id?: string }
        Returns: {
          display_name: string
          group_id: string | null
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
      lock_hosted_room: {
        Args: { p_room_id: string }
        Returns: {
          code: string
          created_at: string
          current_round_id: string | null
          expires_at: string
          group_noun: string
          group_noun_plural: string
          groups_mode: string
          host_id: string
          id: string
          max_participants: number
          point_presets: number[]
          points_enabled: boolean
          reveal_intro_media_id: string | null
          title: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
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
      move_participant: {
        Args: { p_group_id?: string; p_participant_id: string }
        Returns: {
          display_name: string
          group_id: string | null
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
      register_media_asset: {
        Args: {
          p_asset_id: string
          p_bytes: number
          p_duration_ms?: number
          p_kind: string
          p_label?: string
          p_mime_type: string
          p_storage_path: string
        }
        Returns: {
          bytes: number
          created_at: string
          duration_ms: number | null
          host_id: string
          id: string
          kind: string
          label: string | null
          mime_type: string
          storage_path: string
        }
        SetofOptions: {
          from: "*"
          to: "media_assets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_participant: {
        Args: { p_participant_id: string }
        Returns: undefined
      }
      require_room_feature: {
        Args: { p_feature: string; p_room_id: string }
        Returns: undefined
      }
      reset_points: { Args: { p_room_id: string }; Returns: number }
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
      room_has_feature: {
        Args: { p_feature: string; p_room_id: string }
        Returns: boolean
      }
      save_groups: {
        Args: { p_groups: Json; p_room_id: string }
        Returns: {
          color: string
          created_at: string
          emoji: string | null
          id: string
          name: string
          reveal_media_id: string | null
          room_id: string
          sort_order: number
        }[]
        SetofOptions: {
          from: "*"
          to: "groups"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_group_reveal_media: {
        Args: { p_group_id: string; p_media_id?: string }
        Returns: {
          color: string
          created_at: string
          emoji: string | null
          id: string
          name: string
          reveal_media_id: string | null
          room_id: string
          sort_order: number
        }
        SetofOptions: {
          from: "*"
          to: "groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_group_settings: {
        Args: {
          p_mode: string
          p_noun?: string
          p_noun_plural?: string
          p_room_id: string
        }
        Returns: {
          code: string
          created_at: string
          current_round_id: string | null
          expires_at: string
          group_noun: string
          group_noun_plural: string
          groups_mode: string
          host_id: string
          id: string
          max_participants: number
          point_presets: number[]
          points_enabled: boolean
          reveal_intro_media_id: string | null
          title: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_points_settings: {
        Args: { p_enabled: boolean; p_presets?: number[]; p_room_id: string }
        Returns: {
          code: string
          created_at: string
          current_round_id: string | null
          expires_at: string
          group_noun: string
          group_noun_plural: string
          groups_mode: string
          host_id: string
          id: string
          max_participants: number
          point_presets: number[]
          points_enabled: boolean
          reveal_intro_media_id: string | null
          title: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_sorting_text: {
        Args: { p_room_id: string; p_text?: string }
        Returns: Database["public"]["Tables"]["rooms"]["Row"]
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_room_intro_media: {
        Args: { p_media_id?: string; p_room_id: string }
        Returns: {
          code: string
          created_at: string
          current_round_id: string | null
          expires_at: string
          group_noun: string
          group_noun_plural: string
          groups_mode: string
          host_id: string
          id: string
          max_participants: number
          point_presets: number[]
          points_enabled: boolean
          reveal_intro_media_id: string | null
          title: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      shuffle_groups: { Args: { p_room_id: string }; Returns: undefined }
      smallest_group: { Args: { p_room_id: string }; Returns: string }
      undo_last_points: { Args: { p_room_id: string }; Returns: Json }
      void_point_event: {
        Args: { p_event_id: string }
        Returns: {
          created_at: string
          delta: number
          group_id: string | null
          id: string
          participant_id: string | null
          reason: string | null
          room_id: string
          round_id: string | null
          voided_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "point_events"
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
