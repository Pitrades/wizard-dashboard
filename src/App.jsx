import React, { useEffect, useState, useRef } from 'react';
import Papa from 'papaparse';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { motion } from 'framer-motion';

export default function WizardDashboard() {
  const [games, setGames] = useState([]);
  const [players, setPlayers] = useState({});
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [globalRoundsData, setGlobalRoundsData] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });

  const [playerFilter, setPlayerFilter] = useState([]);
  const [playerFilterText, setPlayerFilterText] = useState('');
  const [numPlayers, setPlayerNum] = useState(0);
  const [expandedGame, setExpandedGame] = useState(null);
  const [playerWinsExpanded, setPlayerWinsExpanded] = useState(null);
  const [gamePlayerCountFilter, setGamePlayerCountFilter] = useState(0); // <— NEW FILTER

  const gameRefs = useRef({});

  useEffect(() => {
    async function loadGames() {
      try {
        const responses = await Promise.all(
          Array.from({ length: 37 }).map((_, i) =>
            fetch(`/games/${i + 1}.csv`).then(r => (r.ok ? r.text() : null))
          )
        );

        const parsedGames = responses
          .filter(Boolean)
          .map(text => Papa.parse(text, { header: false }).data);

        const stats = {};
        const gameData = [];
        const maxRoundsGlobal = parsedGames.length ? Math.max(...parsedGames.map(g => g.length - 1)) : 0;

        parsedGames.forEach((game, idx) => {
          if (!game || game.length < 2) return;
          const headers = game[0].filter(Boolean);
          const rounds = game.slice(1);
          gameData.push({ id: idx + 1, headers, rounds });

          headers.forEach(name => {
            if (!stats[name]) stats[name] = {
              games: 0, wins: 0, totalScore: 0,
              roundScores: [], roundBids: [], roundHits: [], zeroBids: [], wonGames: [],
              gamePlayerCounts: [] // track how many players were in each game
            };
          });

          rounds.forEach((round, rIdx) => {
            headers.forEach((name, i) => {
              const scoreStr = round[i * 2];
              const bidStr = round[i * 2 + 1];
              if (scoreStr == null || bidStr == null) return;

              const score = parseInt(scoreStr, 10);
              const bid = parseInt(bidStr, 10);

              if (!stats[name].roundScores[rIdx]) stats[name].roundScores[rIdx] = [];
              if (!stats[name].roundBids[rIdx]) stats[name].roundBids[rIdx] = [];
              if (!stats[name].roundHits[rIdx]) stats[name].roundHits[rIdx] = [];
              if (!stats[name].zeroBids[rIdx]) stats[name].zeroBids[rIdx] = [];

              const prevScore = rIdx === 0 ? 0 : (stats[name].roundScores[rIdx - 1]?.slice(-1)[0] ?? 0);
              const hit = score > prevScore ? 1 : 0;

              stats[name].roundScores[rIdx].push(score);
              stats[name].roundBids[rIdx].push(bid);
              stats[name].roundHits[rIdx].push(hit);
              stats[name].zeroBids[rIdx].push(bid === 0 ? 1 : 0);
            });
          });

          const finalScores = {};
          headers.forEach((name, i) => {
            const lastRow = rounds[rounds.length - 1];
            finalScores[name] = parseInt(lastRow[i * 2] || '0', 10);
          });
          const maxScore = Math.max(...Object.values(finalScores));
          const winners = Object.keys(finalScores).filter(p => finalScores[p] === maxScore);

          headers.forEach(name => {
            stats[name].games += 1;
            stats[name].totalScore += finalScores[name];
            stats[name].gamePlayerCounts.push(headers.length);
            if (winners.includes(name)) {
              stats[name].wins += 1;
              stats[name].wonGames.push(idx + 1);
            }
          });
        });

        const globalData = [];
        for (let rIdx = 0; rIdx < maxRoundsGlobal; rIdx++) {
          const entry = { round: rIdx + 1 };
          Object.keys(stats).forEach(name => {
            const scores = stats[name].roundScores[rIdx] || [];
            const zeros = stats[name].zeroBids[rIdx] || [];
            if (scores.length) {
              entry[`${name}-max`] = Math.max(...scores);
              entry[`${name}-min`] = Math.min(...scores);
            }
            if (zeros.length) {
              entry[`${name}-zero`] = ((zeros.reduce((a, b) => a + b, 0) / zeros.length) * 100).toFixed(1);
            }
          });
          globalData.push(entry);
        }

        setPlayers(stats);
        setGlobalRoundsData(globalData);
        setGames(gameData);
      } catch (err) {
        console.error('Failed to load games:', err);
      }
    }

    loadGames();
  }, []);
  // Compute "relative" win rates only among selected players
  const computeSelectedWinRates = () => {
    if (selectedPlayers.length < 2) return {};
    const relevantGames = games.filter(g =>
      selectedPlayers.every(p => g.headers.includes(p))
    );

    const selectedWins = {};
    selectedPlayers.forEach(p => selectedWins[p] = 0);

    relevantGames.forEach(g => {
      const lastRound = g.rounds[g.rounds.length - 1];
      const finalScores = {};
      g.headers.forEach((name, idx) => {
        const score = parseInt(lastRound[idx * 2] || '0', 10);
        finalScores[name] = score;
      });

      const maxScore = Math.max(...selectedPlayers.map(p => finalScores[p] ?? 0));
      const winners = selectedPlayers.filter(p => finalScores[p] === maxScore);
      winners.forEach(p => selectedWins[p]++);
    });

    const totalGames = relevantGames.length;
    const rates = {};
    selectedPlayers.forEach(p => {
      rates[p] = totalGames > 0 ? ((selectedWins[p] / totalGames) * 100).toFixed(1) : '0.0';
    });
    return rates;
  };
  const selectedWinRates = computeSelectedWinRates();
  // Filter player stats by gamePlayerCountFilter
  const filteredPlayers = Object.entries(players).map(([name, s]) => {
    if (gamePlayerCountFilter > 0) {
      // Filter only games where player played with exactly N players
      const mask = s.gamePlayerCounts.map(c => c === gamePlayerCountFilter);
      const gamesCount = mask.filter(Boolean).length;
      if (gamesCount === 0) return null;
      const avgScore = (s.totalScore / s.games).toFixed(1); // Approximate per-game basis
      const winCount = s.wonGames.filter(gid => {
        const g = games.find(gm => gm.id === gid);
        return g && g.headers.length === gamePlayerCountFilter;
      }).length;

      return {
        name,
        winRate: ((winCount / gamesCount) * 100).toFixed(1),
        avgScore,
        totalGames: gamesCount,
        wins: winCount
      };
    }
    return {
      name,
      winRate: s.games ? ((s.wins / s.games) * 100).toFixed(1) : '0.0',
      avgScore: s.games ? (s.totalScore / s.games).toFixed(1) : '0.0',
      totalGames: s.games || 0,
      wins: s.wins || 0,
    };
  }).filter(Boolean);

  const sortedPlayerData = [...filteredPlayers].sort((a, b) => {
    const { key, direction } = sortConfig;
    const dir = direction === 'asc' ? 1 : -1;
    if (key === 'name') return dir * a.name.localeCompare(b.name);
    return dir * (parseFloat(a[key]) - parseFloat(b[key]));
  });

  const requestSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const togglePlayer = (name) => {
    setSelectedPlayers(prev =>
      prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name]
    );
  };

  const parsePlayerFilter = (text) => text.split(',').map(s => s.trim()).filter(Boolean);
  const applyPlayerFilterFromText = () => setPlayerFilter(parsePlayerFilter(playerFilterText));

  const togglePlayerFilter = (name) => {
    setPlayerFilter(prev => {
      const next = prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name];
      setPlayerFilterText(next.join(', '));
      return next;
    });
  };

  const filteredGames = games.filter(g => {
    if (numPlayers > 0 && g.headers.length !== numPlayers) return false;
    if (playerFilter.length > 0 && !playerFilter.every(p => g.headers.includes(p))) return false;
    return true;
  });

  const playerColors = {
    Silvius: '#8884d8',
    Milena: '#82ca9d',
    Hannah: '#ff7300',
    Finn: '#0088FE',
    Lina: '#c53a3a'
  };
  const color = (name) => playerColors[name] || `#${Math.floor(Math.random() * 16777215).toString(16)}`;

  // Round Data for selected players (chart)
  const roundsData = [];
  if (selectedPlayers.length > 0) {
    const maxRoundsPerPlayer = Math.max(...selectedPlayers.map(name => (players[name]?.roundScores.length || 0)));
    for (let rIdx = 0; rIdx < maxRoundsPerPlayer; rIdx++) {
      const roundEntry = { round: rIdx + 1 };
      let hasData = false;

      selectedPlayers.forEach(name => {
        const player = players[name];
        if (!player) return;

        const scores = player.roundScores[rIdx] || [];
        const bids = player.roundBids[rIdx] || [];
        const hits = player.roundHits[rIdx] || [];

        if (scores.length || bids.length || hits.length) {
          hasData = true;
          if (scores.length) roundEntry[`${name}-score`] = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
          if (bids.length) roundEntry[`${name}-bid`] = (bids.reduce((a, b) => a + b, 0) / bids.length).toFixed(1);
          if (hits.length) roundEntry[`${name}-hit`] = ((hits.reduce((a, b) => a + b, 0) / hits.length) * 100).toFixed(1);
        }
      });

      if (hasData) roundsData.push(roundEntry);
    }
  }

  const openGameAndScroll = (gameId) => {
    setExpandedGame(gameId);
    const ref = gameRefs.current[gameId];
    if (ref) {
      const top = ref.getBoundingClientRect().top + window.scrollY;
      const offset = 100;
      window.scrollTo({ top: top - offset, behavior: 'smooth' });
      ref.classList.add('bg-yellow-100');
      setTimeout(() => ref.classList.remove('bg-yellow-100'), 1500);
    }
  };

  return (
    <div className="p-6 space-y-8">
      <motion.h1 className="text-3xl font-bold text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        Wizard Game Stats Dashboard
      </motion.h1>

      {/* Player Count Filter for Stats */}
      <Card>
        <CardHeader><CardTitle>Filters for Stats</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-4 items-center">
            <label className="flex items-center gap-2">
              Show games with exactly:
              <select
                className="border rounded p-1 ml-2"
                value={gamePlayerCountFilter}
                onChange={(e) => setGamePlayerCountFilter(Number(e.target.value))}
              >
                <option value={0}>All</option>
                <option value={3}>3 Players</option>
                <option value={4}>4 Players</option>
                <option value={5}>5 Players</option>
                <option value={6}>6 Players</option>
              </select>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Overall Stats Table */}
      <Card>
        <CardHeader><CardTitle>Overall Player Stats</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {['name', 'totalGames', 'wins', 'winRate', 'selectedWinRate'].map(col => (
                  <TableHead key={col} onClick={() => requestSort(col)} className="cursor-pointer select-none">
                    {col === 'name' ? 'Player' :
                      col === 'totalGames' ? 'Games' :
                        col === 'wins' ? 'Wins' :
                          col === 'winRate' ? 'Win Rate (%)' :
                            'Win Rate (vs selected)'}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPlayerData.map(p => (
                <React.Fragment key={p.name}>
                  <TableRow>
                    <TableCell>
                      <Button variant="link" onClick={() => togglePlayer(p.name)}>
                        {selectedPlayers.includes(p.name) ? '✓ ' : ''}{p.name}
                      </Button>
                    </TableCell>
                    <TableCell>{p.totalGames}</TableCell>
                    <TableCell>
                      <Button
                        variant="link"
                        onClick={() => setPlayerWinsExpanded(playerWinsExpanded === p.name ? null : p.name)}
                      >
                        {p.wins}
                      </Button>
                    </TableCell>
                    <TableCell>{p.winRate}</TableCell>
                      <TableCell>
                    {selectedPlayers.length > 1 && selectedWinRates[p.name]
                      ? `${selectedWinRates[p.name]}`
                      : '-'}
                  </TableCell>
                  </TableRow>
{playerWinsExpanded === p.name && (
  <TableRow>
    <TableCell colSpan={5}>
      Won Games:{' '}
      {players[p.name].wonGames
        .filter(id => {
          // Only show games that match the player count filter
          if (gamePlayerCountFilter === 0) return true;
          const g = games.find(gm => gm.id === id);
          return g && g.headers.length === gamePlayerCountFilter;
        })
        .map(id => (
          <Button key={id} variant="link" onClick={() => openGameAndScroll(id)}>
            {id}
          </Button>
        ))}
    </TableCell>
  </TableRow>
)}

                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Player-Specific Round Charts */}
      {selectedPlayers.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle>Average Score per Round</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={roundsData}>
                  <XAxis dataKey="round" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {selectedPlayers.map(name => (
                    <Line key={name} dataKey={`${name}-score`} name={name} stroke={color(name)} strokeWidth={2} dot={{ r: 5 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Average Bid per Round</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={roundsData}>
                  <XAxis dataKey="round" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {selectedPlayers.map(name => (
                    <Line key={name} dataKey={`${name}-bid`} name={name} stroke={color(name)} strokeWidth={2} dot={{ r: 5 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Hit Rate per Round (%)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={roundsData}>
                  <XAxis dataKey="round" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {selectedPlayers.map(name => (
                    <Line key={name} dataKey={`${name}-hit`} name={name} stroke={color(name)} strokeWidth={2} dot={{ r: 5 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Zero Bid Percentage per Round (Per Player)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={globalRoundsData}>
                  <XAxis dataKey="round" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {selectedPlayers.map(name => (
                    <Line key={name} dataKey={`${name}-zero`} name={`${name} 0%`} stroke={color(name)} strokeWidth={2} dot={{ r: 5 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="col-span-full">
            <CardHeader><CardTitle>Max/Min Score per Round (All Players)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={globalRoundsData}>
                  <XAxis dataKey="round" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {selectedPlayers.flatMap(name => [
                    <Line key={`${name}-max`} dataKey={`${name}-max`} name={`${name} Max`} stroke={color(name)} strokeWidth={2} dot={{ r: 4 }} />,
                    <Line key={`${name}-min`} dataKey={`${name}-min`} name={`${name} Min`} stroke={color(name)} strokeWidth={2} strokeDasharraydot={{ r: 4 }} />
                  ])}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filter controls */}
      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4 flex-wrap items-center">
            <label className="flex items-center gap-2">
              Num of Players:
              <input
                type="number"
                className="ml-2 border p-1 w-20 rounded"
                value={numPlayers}
                onChange={e => setPlayerNum(Number(e.target.value))}
                min={0}
              />
            </label>

            <label className="flex items-center gap-2">
              Filter Players (type comma separated, press Enter or click outside):
              <input
                type="text"
                inputMode="text"
                pattern=".*"
                autoComplete="off"
                className="ml-2 border p-1 rounded w-72"
                placeholder="e.g. Silvius, Finn"
                value={playerFilterText}
                onChange={e => setPlayerFilterText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    applyPlayerFilterFromText();
                  }
                }}
                onBlur={() => applyPlayerFilterFromText()}
              />
            </label>
          </div>

          <div className="flex gap-2 flex-wrap">
            {Object.keys(players).map(name => (
              <button
                key={name}
                onClick={() => togglePlayerFilter(name)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: playerFilter.includes(name) ? `2px solid ${color(name)}` : '1px solid #ccc',
                  background: playerFilter.includes(name) ? '#fff' : 'transparent',
                  cursor: 'pointer',
                }}
                aria-pressed={playerFilter.includes(name)}
              >
                {playerFilter.includes(name) ? '✓ ' : ''}{name}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Game History Browser */}
      <Card>
        <CardHeader><CardTitle>Game History</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredGames.length === 0 && <div>No games match the current filters.</div>}
            {filteredGames.map((g) => (
              <Card
                key={g.id}
                ref={el => gameRefs.current[g.id] = el}
                className="border border-gray-300 transition-colors duration-300"
              >
                <CardHeader
                  onClick={() => setExpandedGame(expandedGame === g.id ? null : g.id)}
                  className="cursor-pointer flex justify-between items-center"
                >
                  <span>Game {g.id} — {g.headers.join(', ')}</span>
                  <span>{expandedGame === g.id ? '▲' : '▼'}</span>
                </CardHeader>
{expandedGame === g.id && (
  <CardContent>
    <div className="flex flex-col xl:flex-row gap-6">
      {/* Game Table */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Round</TableHead>
              {g.headers.map(h => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {g.rounds.map((r, i) => (
              <TableRow key={i}>
                <TableCell>{i + 1}</TableCell>
                {g.headers.map((h, idx) => {
                  const score = r[idx * 2];
                  const bid = r[idx * 2 + 1];
                  return (
                    <TableCell key={h}>
                      {score} ({bid})
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Game Image */}
      <div className="flex-1 flex justify-center items-start">
        <img
          src={`/games/${g.id}.jpeg`}
          alt={`Game ${g.id}`}
          className="w-full max-w-[500px] max-h-[500px] object-contain rounded shadow-md"
        />
      </div>
    </div>
  </CardContent>
)}

              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
