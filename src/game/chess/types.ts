import { BaseGameEventType } from "../../types/game";

/** A chess move, expressed the way chess.js expects it. */
export interface ChessAction {
  from: string; // e.g. "e2"
  to: string; // e.g. "e4"
  promotion?: "q" | "r" | "b" | "n";
}

export type ChessGameEventType =
  | BaseGameEventType
  | "MOVE_PLAYED"
  | "CHECK_GIVEN"
  | "CHECKMATE"
  | "STALEMATE"
  | "CAPTURE_MADE"
  | "PIECE_BLUNDERED" // material given away for nothing — feeds PLAYER_MADE_MISTAKE
  | "GOOD_TACTIC_FOUND" // feeds PLAYER_PERFORMED_EXCEPTIONALLY
  | "MOVE_ANALYZED"; // fired asynchronously once ChessContextEngine finishes real engine analysis of a move — arrives later than MOVE_PLAYED, since it requires two Stockfish searches

export interface ChessBoardState {
  fen: string;
  pgn: string;
  turn: "w" | "b";
  inCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isDraw: boolean;
  isGameOver: boolean;
  lastMove: { from: string; to: string; san: string } | null;
  capturedByWhite: string[]; // black pieces white has captured
  capturedByBlack: string[]; // white pieces black has captured
}
