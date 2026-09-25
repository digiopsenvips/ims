import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Game } from '../types';
import { Gamepad2, Trophy, Frown, Sparkles, CheckCircle2, ArrowLeft, Loader2 } from 'lucide-react';

export const CustomerGameQrPage: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const [game, setGame] = useState<Game | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    if (gameId) {
      api
        .get(`/games/${gameId}`)
        .then(res => {
          if (res?.game) setGame(res.game);
        })
        .catch(console.error)
        .finally(() => setIsLoading(false));
    } else {
      api
        .get('/games?status=ACTIVE')
        .then(res => {
          if (res?.games) setGames(res.games);
        })
        .catch(console.error)
        .finally(() => setIsLoading(false));
    }
  }, [gameId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="w-10 h-10 animate-spin text-purple-400 mb-3" />
        <p className="text-sm font-bold">Loading Game Information...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6">
      {/* Brand Header */}
      <div className="max-w-md mx-auto w-full text-center space-y-1 pt-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-950/80 border border-purple-800 text-purple-300 text-xs font-black tracking-wider uppercase">
          <Sparkles className="w-3.5 h-3.5" />
          <span>ENACTUS VIPS-TC STALL</span>
        </div>
        <h1 className="text-xs text-slate-400 font-semibold tracking-wider uppercase mt-1">
          Student Social Entrepreneurship
        </h1>
      </div>

      {/* Main Game Showcase */}
      <div className="max-w-md mx-auto w-full my-6">
        {game ? (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-purple-600/20 border border-purple-500/40 text-purple-400 flex items-center justify-center text-3xl mx-auto shadow-inner">
              🎯
            </div>

            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                {game.name}
              </h2>
              {game.projectName && (
                <div className="text-xs font-bold text-purple-400 uppercase tracking-widest mt-1">
                  Project {game.projectName}
                </div>
              )}
            </div>

            <div className="inline-block px-5 py-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <span className="text-xs font-bold uppercase tracking-wider block text-slate-400">Entry Fee</span>
              <span className="text-3xl font-black">₹{game.entryFee}</span>
            </div>

            {game.description && (
              <div className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/60 text-left">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  How To Play & Rules:
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {game.description}
                </p>
              </div>
            )}

            {/* Rewards Showcase */}
            <div className="space-y-2.5 text-left">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Prizes & Rewards:
              </div>

              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3.5 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center text-xl shrink-0">
                  🏆
                </div>
                <div>
                  <div className="text-xs font-black text-amber-300 uppercase tracking-wide">
                    WIN PRIZE
                  </div>
                  <div className="text-sm font-bold text-white">
                    {game.winReward.productName} × {game.winReward.quantity}
                  </div>
                </div>
              </div>

              {game.loseReward && (
                <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-3.5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-700 text-slate-300 flex items-center justify-center text-xl shrink-0">
                    🎁
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                      PARTICIPATION PRIZE
                    </div>
                    <div className="text-sm font-bold text-white">
                      {game.loseReward.productName} × {game.loseReward.quantity}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2 text-[11px] text-slate-500">
              * Payment and physical game results are verified and recorded by the Enactus volunteer at the stall.
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-4">
            <h2 className="text-lg font-bold text-white">Stall Games Available</h2>
            <div className="space-y-2">
              {games.map(g => (
                <Link
                  key={g.id}
                  to={`/play/${g.id}`}
                  className="block bg-slate-800 hover:bg-slate-700/80 p-4 rounded-xl border border-slate-700 transition-colors text-left"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-white text-sm">🎯 {g.name}</span>
                    <span className="font-black text-emerald-400">₹{g.entryFee}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    WIN: {g.winReward.productName}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center py-2 text-[11px] text-slate-600">
        Enactus VIPS-TC &bull; Empowering Communities Through Social Enterprise
      </div>
    </div>
  );
};
