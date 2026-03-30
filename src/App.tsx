/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef, useMemo } from 'react';
import Globe from 'react-globe.gl';
import { 
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User, testConnection 
} from './firebase';
import { 
  doc, setDoc, getDoc, updateDoc, collection, onSnapshot, addDoc, query, getDocs, where, deleteDoc 
} from 'firebase/firestore';
import { 
  Globe as GlobeIcon, 
  LogOut, 
  MapPin, 
  Plus, 
  User as UserIcon, 
  ChevronRight,
  Loader2,
  X,
  Search,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { debounce } from 'lodash';
import { summarizeDescription, generateLifeLogs, generateCurrentState } from './services/aiService';
import { format } from 'date-fns';

// --- Types ---
interface AvatarData {
  id: string;
  uid: string;
  description: string;
  age: number;
  gender: string;
  race: string;
  occupation: string;
  lat: number;
  lng: number;
  color: string;
  imageUrl: string;
  lastVisit: string;
  lastLogTimestamp?: string;
  createdAt: string;
  currentStatus?: string;
}

interface LifeLog {
  id: string;
  uid: string;
  text: string;
  timestamp: string;
}

// --- Components ---

const DrawingCanvas = ({ onSave, initialColor = '#ffffff' }: { onSave: (dataUrl: string) => void, initialColor?: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState(initialColor);
  const [brushSize, setBrushSize] = useState(5);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
  }, [color, brushSize]);

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    let x, y;
    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      onSave(canvas.toDataURL());
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    let x, y;
    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onSave('');
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-2 flex-wrap">
          {['#ffffff', '#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff'].map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-5 h-5 bg-transparent border-0 p-0 cursor-pointer" />
        </div>
        <button onClick={clear} className="text-[10px] uppercase tracking-widest opacity-40 hover:opacity-100">Clear</button>
      </div>
      <div className="relative aspect-square w-full bg-white/5 rounded-xl overflow-hidden border border-white/10 cursor-crosshair">
        <canvas
          ref={canvasRef}
          width={400}
          height={400}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="w-full h-full"
        />
      </div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [myAvatar, setMyAvatar] = useState<AvatarData | null>(null);
  const [allAvatars, setAllAvatars] = useState<AvatarData[]>([]);
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarData | null>(null);
  const [lifeLogs, setLifeLogs] = useState<LifeLog[]>([]);
  const [isGeneratingLogs, setIsGeneratingLogs] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  
  // New Avatar State
  const [newAvatarDesc, setNewAvatarDesc] = useState('');
  const [newAvatarAge, setNewAvatarAge] = useState<number>(25);
  const [newAvatarGender, setNewAvatarGender] = useState('Prefer not to say');
  const [newAvatarRace, setNewAvatarRace] = useState('Prefer not to say');
  const [newAvatarOccupation, setNewAvatarOccupation] = useState('');
  const [newAvatarColor, setNewAvatarColor] = useState('#ffffff');
  const [newAvatarImageUrl, setNewAvatarImageUrl] = useState('');
  
  const [tempMarker, setTempMarker] = useState<{ lat: number; lng: number } | null>(null);
  const [viewMode, setViewMode] = useState<'intro' | 'globe'>('intro');
  const [isRotating, setIsRotating] = useState(true);
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  // Privacy Summary State
  const [avatarSummary, setAvatarSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const TARGET_ASPECT = 16 / 9;
  const [stageDimensions, setStageDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const globeRef = useRef<any>();

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;

      const windowAspect = w / h;
      let stageW, stageH;

      if (windowAspect > TARGET_ASPECT) {
        stageH = h;
        stageW = h * TARGET_ASPECT;
      } else {
        stageW = w;
        stageH = w / TARGET_ASPECT;
      }
      setStageDimensions({ width: stageW, height: stageH });
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Responsive Earth Scaling
  useEffect(() => {
    if (globeRef.current) {
      // Calculate responsive altitude based on stage size
      const baseAltitude = 2.5;
      const minDim = Math.min(stageDimensions.width, stageDimensions.height);
      const responsiveAltitude = baseAltitude * (1000 / Math.max(minDim, 400));
      
      globeRef.current.pointOfView({ altitude: responsiveAltitude }, 400);
    }
  }, [stageDimensions, viewMode]);

  // Initialize
  useEffect(() => {
    testConnection();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Ensure globe rotation and zoom limits
  useEffect(() => {
    const timer = setTimeout(() => {
      if (globeRef.current) {
        const controls = globeRef.current.controls();
        if (controls) {
          controls.autoRotate = isRotating && !isCreating;
          controls.autoRotateSpeed = 0.5;
          controls.minDistance = 150; // Zoom in limit
          controls.maxDistance = 400; // Zoom out limit
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [isRotating, isCreating]);

  // Fetch all avatars
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'avatars'), (snapshot) => {
      const avatars = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AvatarData));
      setAllAvatars(avatars);
    });
    return () => unsubscribe();
  }, []);

  // Fetch my avatar
  useEffect(() => {
    if (!user) {
      setMyAvatar(null);
      return;
    }

    const unsubscribe = onSnapshot(query(collection(db, 'avatars'), where('uid', '==', user.uid)), async (snapshot) => {
      if (snapshot.empty) {
        setMyAvatar(null);
        return;
      }

      const avatar = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as AvatarData;
      setMyAvatar(avatar);
    });

    return () => unsubscribe();
  }, [user]);

  // Fetch summary for selected avatar
  useEffect(() => {
    if (!selectedAvatar) {
      setAvatarSummary(null);
      return;
    }

    // Generate summary if not the owner
    if (selectedAvatar.uid !== user?.uid) {
      setIsSummarizing(true);
      summarizeDescription(selectedAvatar.description).then(summary => {
        setAvatarSummary(summary);
        setIsSummarizing(false);
      });
    }
  }, [selectedAvatar, user]);

  const debouncedSearch = useMemo(
    () => debounce(async (query: string) => {
      if (!query || query.length < 3) {
        setSearchResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
        const data = await res.json();
        setSearchResults(data);
      } catch (err) {
        console.error("Search failed", err);
      } finally {
        setIsSearching(false);
      }
    }, 500),
    []
  );

  useEffect(() => {
    debouncedSearch(searchQuery);
  }, [searchQuery, debouncedSearch]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Login failed", err);
    }
  };

  const handleCreateAvatar = async () => {
    if (!user || !tempMarker || !newAvatarDesc || !newAvatarImageUrl) return;

    const now = new Date().toISOString();

    try {
      setCreateError(null);
      
      // Generate initial dynamic status
      const initialStatus = await generateCurrentState({
        age: newAvatarAge,
        gender: newAvatarGender,
        occupation: newAvatarOccupation,
        description: newAvatarDesc,
        lat: tempMarker.lat,
        lng: tempMarker.lng
      });

      const avatarData = {
        uid: user.uid,
        description: newAvatarDesc,
        age: newAvatarAge,
        gender: newAvatarGender,
        race: newAvatarRace,
        occupation: newAvatarOccupation,
        color: newAvatarColor,
        imageUrl: newAvatarImageUrl,
        lat: tempMarker.lat,
        lng: tempMarker.lng,
        lastVisit: now,
        createdAt: now,
        lastLogTimestamp: now,
        currentStatus: initialStatus
      };

      const docRef = await addDoc(collection(db, 'avatars'), avatarData);
      setIsCreating(false);
      
      // Reset form fields
      setTempMarker(null);
      setNewAvatarDesc('');
      setNewAvatarAge(25);
      setNewAvatarGender('Prefer not to say');
      setNewAvatarRace('Prefer not to say');
      setNewAvatarOccupation('');
      setNewAvatarColor('#ffffff');
      setNewAvatarImageUrl('');
      setSearchQuery('');
      
      // Zoom to the new digital self
      const newAvatar = { id: docRef.id, ...avatarData } as AvatarData;
      focusOnAvatar(newAvatar);
    } catch (err: any) {
      console.error("Creation failed", err);
      if (err.message?.includes('quota')) {
        setCreateError("Daily database quota exceeded. Please try again tomorrow.");
      } else {
        setCreateError("Failed to create digital self. Please try again.");
      }
    }
  };

  const handleDeleteAvatar = async () => {
    if (!myAvatar || !user) return;
    
    try {
      // Delete the avatar document
      await deleteDoc(doc(db, 'avatars', myAvatar.id));
      
      setMyAvatar(null);
      setSelectedAvatar(null);
      setIsDeleting(false);

      // Reset form fields just in case
      setTempMarker(null);
      setNewAvatarDesc('');
      setNewAvatarAge(25);
      setNewAvatarGender('Prefer not to say');
      setNewAvatarRace('Prefer not to say');
      setNewAvatarOccupation('');
      setNewAvatarColor('#ffffff');
      setSearchQuery('');
    } catch (err) {
      console.error("Delete failed", err);
      alert("Failed to delete digital self. Please check your connection.");
    }
  };

  const focusOnAvatar = async (avatar: AvatarData) => {
    if (globeRef.current) {
      const minDim = Math.min(stageDimensions.width, stageDimensions.height);
      const responsiveAltitude = 1.5 * (1000 / Math.max(minDim, 400));
      
      globeRef.current.pointOfView({
        lat: avatar.lat,
        lng: avatar.lng,
        altitude: responsiveAltitude
      }, 1000);
      setSelectedAvatar(avatar);
      setLifeLogs([]);

      // Fetch existing logs
      const logsQuery = query(
        collection(db, 'avatars', avatar.id, 'life_logs'),
        where('uid', '==', avatar.uid)
      );
      const logsSnap = await getDocs(logsQuery);
      const existingLogs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() } as LifeLog))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setLifeLogs(existingLogs);

      // Refresh status if stale (older than 1 hour)
      const lastVisit = avatar.lastVisit ? new Date(avatar.lastVisit) : new Date(0);
      const isStale = (new Date().getTime() - lastVisit.getTime()) > (1000 * 60 * 60);

      if (isStale) {
        try {
          const newStatus = await generateCurrentState(avatar);
          await updateDoc(doc(db, 'avatars', avatar.id), {
            currentStatus: newStatus,
            lastVisit: new Date().toISOString()
          });
          setSelectedAvatar(prev => prev ? { ...prev, currentStatus: newStatus, lastVisit: new Date().toISOString() } : null);
        } catch (error) {
          console.error("Failed to refresh status", error);
        }
      }

      // If it's the user's avatar, check for missing days and generate new logs
      if (avatar.uid === user?.uid) {
        setIsGeneratingLogs(true);
        try {
          const now = new Date();
          const lastLogDate = avatar.lastLogTimestamp ? new Date(avatar.lastLogTimestamp) : new Date(avatar.createdAt);
          
          // Calculate days passed (ignoring time for day count)
          const start = new Date(lastLogDate.getFullYear(), lastLogDate.getMonth(), lastLogDate.getDate());
          const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const diffTime = Math.abs(end.getTime() - start.getTime());
          const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

          let newLogs: { text: string, timestamp: string }[] = [];
          if (diffDays > 0) {
            newLogs = await generateLifeLogs(
              avatar, 
              existingLogs.map(l => l.text).reverse(), 
              diffDays, 
              lastLogDate
            );

            // Save new logs
            for (const log of newLogs) {
              await addDoc(collection(db, 'avatars', avatar.id, 'life_logs'), {
                uid: avatar.uid,
                text: log.text,
                timestamp: log.timestamp
              });
            }
          }

          // Update avatar with new status and lastLogTimestamp
          const updateData: any = {
            lastVisit: now.toISOString()
          };
          if (newLogs.length > 0) {
            updateData.lastLogTimestamp = newLogs[newLogs.length - 1].timestamp;
          }

          await updateDoc(doc(db, 'avatars', avatar.id), updateData);
          
          // Update local state
          const updatedAvatar = { ...avatar, ...updateData };
          setSelectedAvatar(updatedAvatar);
          
          // Refresh logs if new ones were added
          if (newLogs.length > 0) {
            const refreshedLogsSnap = await getDocs(logsQuery);
            const refreshedLogs = refreshedLogsSnap.docs.map(d => ({ id: d.id, ...d.data() } as LifeLog))
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            setLifeLogs(refreshedLogs);
          }
        } catch (error) {
          console.error("Failed to update life logs", error);
        } finally {
          setIsGeneratingLogs(false);
        }
      }
    }
  };

  const globeData = useMemo(() => {
    return allAvatars.map(a => ({
      ...a,
      size: a.uid === user?.uid ? 3.6 : 1.8,
    }));
  }, [allAvatars, user]);

  const ringsData = useMemo(() => {
    return []; // Pulsing animation removed
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-space-black">
        <Loader2 className="w-8 h-8 animate-spin text-white/50" />
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black flex items-center justify-center">
      {/* Locked Aspect Ratio Container */}
      <div 
        className="relative overflow-hidden app-stage"
        style={{ 
          width: stageDimensions.width, 
          height: stageDimensions.height,
        }}
      >
        {/* Globe Background */}
        <div className="absolute inset-0 z-0 globe-container flex items-center justify-center">
            <Globe
              ref={globeRef}
              width={stageDimensions.width}
              height={stageDimensions.height}
              globeImageUrl="https://i.postimg.cc/d3QZvHqD/Untitled-Artwork-39.png"
            backgroundImageUrl=""
            backgroundColor="rgba(0,0,0,0)"
            htmlElementsData={globeData}
            htmlElement={(d: any) => {
              const el = document.createElement('div');
              el.style.width = `${d.size * 15}px`;
              el.style.height = `${d.size * 15}px`;
              el.style.pointerEvents = 'auto';
              el.style.cursor = 'pointer';
              el.style.transition = 'transform 0.2s ease-in-out';
              
              const img = document.createElement('img');
              img.src = d.imageUrl || 'https://picsum.photos/seed/avatar/200/200';
              img.style.width = '100%';
              img.style.height = '100%';
              img.style.objectFit = 'contain';
              img.style.filter = `drop-shadow(0 0 5px ${d.color || '#ffffff'})`;
              
              el.appendChild(img);
              
              el.onmouseenter = () => {
                el.style.transform = 'scale(1.2)';
              };
              el.onmouseleave = () => {
                el.style.transform = 'scale(1)';
              };
              el.onclick = () => focusOnAvatar(d);
              
              return el;
            }}
            onGlobeClick={(coords) => {
              if (isCreating) setTempMarker({ lat: coords.lat, lng: coords.lng });
              else setSelectedAvatar(null);
            }}
            atmosphereColor="#000000"
            atmosphereAltitude={0.04}
            autoRotate={isRotating && !isCreating}
            autoRotateSpeed={0.5}
          />
      </div>

      {/* Intro Overlay */}
      <AnimatePresence>
        {viewMode === 'intro' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/80 pointer-events-none"
          >
            <div className="max-w-md text-center px-6 pointer-events-auto">
              <motion.h1 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-4xl font-light tracking-[0.4em] mb-6 glow-text uppercase"
              >
                IDLE EARTH: WHERE THE DIGITAL YOU LIVE
              </motion.h1>
              <motion.p 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-white/60 font-light leading-relaxed mb-12"
              >
                Every visitor can create a small digital self anchored somewhere on Earth. 
                While you are away, your digital self continues evolving, moving, and living. 
                Return to discover where you've gone.
              </motion.p>
              
              <motion.button
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 1 }}
                onClick={() => setViewMode('globe')}
                className="px-8 py-3 border border-white/20 rounded-full hover:bg-white/10 transition-all tracking-widest text-sm"
              >
                ENTER THE WORLD
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main UI Controls */}
      {viewMode === 'globe' && (
        <>
          {/* Top Bar */}
          <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start z-20 pointer-events-none">
            <div className="pointer-events-auto">
              <h2 className="text-sm tracking-[0.3em] font-light opacity-50 text-black">IDLE EARTH</h2>
            </div>
            
            <div className="flex flex-col items-end gap-4 pointer-events-auto">
              {!user ? (
                <button 
                  onClick={handleLogin}
                  className="px-4 py-2 glass-panel rounded-full text-xs tracking-widest hover:bg-white/10 transition-all"
                >
                  SIGN IN
                </button>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="text-right text-black">
                    <p className="text-[10px] opacity-40 uppercase tracking-tighter">Authenticated as</p>
                    <p className="text-xs font-light">{user.displayName || user.email}</p>
                  </div>
                  <button 
                    onClick={() => signOut(auth)}
                    className="p-2 glass-panel rounded-full hover:bg-white/10 transition-all"
                  >
                    <LogOut size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Controls */}
          <div className="absolute bottom-0 left-0 w-full p-8 flex justify-center z-20 pointer-events-none">
            <div className="pointer-events-auto">
              {!myAvatar && user && !isCreating && (
                <button 
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-3 px-8 py-4 glass-panel rounded-full hover:bg-white/10 transition-all group"
                >
                  <Plus size={18} className="group-hover:rotate-90 transition-transform" />
                  <span className="text-sm tracking-widest font-light uppercase">create your digital self</span>
                </button>
              )}
              
              {myAvatar && (
                <button 
                  onClick={() => focusOnAvatar(myAvatar)}
                  className="flex items-center gap-3 px-6 py-3 glass-panel rounded-full hover:bg-white/10 transition-all"
                >
                  <UserIcon size={16} className="text-white/60" />
                  <span className="text-xs tracking-widest font-light">VIEW MY DIGITAL SELF</span>
                </button>
              )}
            </div>
          </div>

          {/* Creation Panel */}
          <AnimatePresence>
            {isCreating && (
              <motion.div 
                initial={{ x: -400, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -400, opacity: 0 }}
                className="absolute left-8 top-1/2 -translate-y-1/2 w-80 glass-panel rounded-3xl p-8 z-30 overflow-y-auto max-h-[90vh]"
              >
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-sm tracking-widest font-light uppercase">create your digital self</h3>
                  <button onClick={() => setIsCreating(false)} className="opacity-40 hover:opacity-100">
                    <X size={16} />
                  </button>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest opacity-40 block mb-2">1. Search Location</label>
                    <div className="relative">
                      <div className="flex items-center gap-2 p-3 border border-white/10 rounded-xl bg-white/5">
                        <Search size={14} className="opacity-40" />
                        <input 
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="City, Country..."
                          className="bg-transparent text-xs font-light focus:outline-none w-full"
                        />
                        {isSearching && <Loader2 size={12} className="animate-spin opacity-40" />}
                      </div>
                      
                      <AnimatePresence>
                        {searchResults.length > 0 && (
                          <motion.div 
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="absolute top-full left-0 w-full mt-2 glass-panel rounded-xl overflow-hidden z-50 border border-white/10"
                          >
                            {searchResults.map((res: any) => (
                              <button
                                key={res.place_id}
                                onClick={() => {
                                  const lat = parseFloat(res.lat);
                                  const lng = parseFloat(res.lon);
                                  setTempMarker({ lat, lng });
                                  setSearchQuery(res.display_name);
                                  setSearchResults([]);
                                  if (globeRef.current) {
                                    globeRef.current.pointOfView({ lat, lng, altitude: 1.5 }, 1000);
                                  }
                                }}
                                className="w-full p-3 text-left text-[10px] hover:bg-white/10 border-b border-white/5 last:border-0 truncate"
                              >
                                {res.display_name}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase tracking-widest opacity-40 block mb-2">2. Or Click on Globe</label>
                    <div className="p-3 border border-white/10 rounded-xl bg-white/5 text-xs font-light">
                      {tempMarker ? (
                        <div className="flex items-center gap-2 text-emerald-400">
                          <MapPin size={14} />
                          <span>{tempMarker.lat.toFixed(2)}, {tempMarker.lng.toFixed(2)}</span>
                        </div>
                      ) : (
                        <span className="opacity-40 italic">Click on the globe...</span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] uppercase tracking-widest opacity-40 block mb-2">Age</label>
                      <input 
                        type="number"
                        value={newAvatarAge}
                        onChange={(e) => setNewAvatarAge(parseInt(e.target.value))}
                        className="w-full p-3 border border-white/10 rounded-xl bg-white/5 text-xs font-light focus:outline-none focus:border-white/30"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest opacity-40 block mb-2">Gender</label>
                      <select 
                        value={newAvatarGender}
                        onChange={(e) => setNewAvatarGender(e.target.value)}
                        className="w-full p-3 border border-white/10 rounded-xl bg-white/5 text-xs font-light focus:outline-none focus:border-white/30 appearance-none"
                      >
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase tracking-widest opacity-40 block mb-2">Race / Ethnicity</label>
                    <input 
                      type="text"
                      value={newAvatarRace}
                      onChange={(e) => setNewAvatarRace(e.target.value)}
                      placeholder="e.g. Asian, Caucasian, etc."
                      className="w-full p-3 border border-white/10 rounded-xl bg-white/5 text-xs font-light focus:outline-none focus:border-white/30"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] uppercase tracking-widest opacity-40 block mb-2">Occupation</label>
                    <input 
                      type="text"
                      value={newAvatarOccupation}
                      onChange={(e) => setNewAvatarOccupation(e.target.value)}
                      placeholder="e.g. Software Engineer, Artist"
                      className="w-full p-3 border border-white/10 rounded-xl bg-white/5 text-xs font-light focus:outline-none focus:border-white/30"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] uppercase tracking-widest opacity-40 block mb-2">3. Draw Your Avatar</label>
                    <DrawingCanvas onSave={setNewAvatarImageUrl} initialColor={newAvatarColor} />
                  </div>

                  <div>
                    <label className="text-[10px] uppercase tracking-widest opacity-40 block mb-2">Personality & Ambitions</label>
                    <textarea 
                      value={newAvatarDesc}
                      onChange={(e) => setNewAvatarDesc(e.target.value)}
                      placeholder="Describe your digital self..."
                      className="w-full h-24 p-3 border border-white/10 rounded-xl bg-white/5 text-xs font-light focus:outline-none focus:border-white/30 resize-none"
                    />
                  </div>

                  {createError && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                      <p className="text-[10px] text-red-400 uppercase tracking-widest text-center">{createError}</p>
                    </div>
                  )}

                  <button 
                    disabled={!tempMarker || !newAvatarDesc || !newAvatarImageUrl}
                    onClick={handleCreateAvatar}
                    className="w-full py-4 bg-white text-black rounded-full text-xs tracking-[0.2em] font-bold disabled:opacity-20 disabled:cursor-not-allowed hover:bg-white/90 transition-all"
                  >
                    CONFIRM CREATION
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Avatar Details Panel */}
          <AnimatePresence>
            {selectedAvatar && (
              <motion.div 
                initial={{ x: 400, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 400, opacity: 0 }}
                className="absolute right-8 top-1/2 -translate-y-1/2 w-96 glass-panel rounded-3xl flex flex-col max-h-[85vh] z-30 overflow-hidden"
              >
                {/* Scrollable Container */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  <div className="p-8">
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h3 className="text-sm tracking-widest font-light mb-1 flex items-center gap-3">
                          <div className="w-10 h-10 bg-white/5 rounded-lg overflow-hidden border border-white/10">
                            <img 
                              src={selectedAvatar.imageUrl} 
                              alt="Avatar" 
                              className="w-full h-full object-contain"
                              style={{ filter: `drop-shadow(0 0 5px ${selectedAvatar.color || '#ffffff'})` }}
                            />
                          </div>
                          {selectedAvatar.uid === user?.uid ? 'MY DIGITAL SELF' : 'ANOTHER LIFE'}
                        </h3>
                        <p className="text-[10px] opacity-40 uppercase tracking-widest flex items-center gap-1">
                          <MapPin size={10} />
                          {selectedAvatar.lat.toFixed(2)}, {selectedAvatar.lng.toFixed(2)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedAvatar.uid === user?.uid && (
                          <button 
                            onClick={() => setIsDeleting(true)}
                            className="p-2 text-red-400 opacity-40 hover:opacity-100 transition-all"
                            title="Delete Digital Self"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        <button onClick={() => setSelectedAvatar(null)} className="opacity-40 hover:opacity-100 p-2">
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>

                    <AnimatePresence>
                      {isDeleting && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl overflow-hidden"
                        >
                          <p className="text-[10px] text-red-400 uppercase tracking-widest mb-3 text-center">Delete your digital self?</p>
                          <div className="flex gap-2">
                            <button 
                              onClick={handleDeleteAvatar}
                              className="flex-1 py-2 bg-red-500 text-white text-[10px] font-bold rounded-lg uppercase tracking-widest"
                            >
                              Yes, Delete
                            </button>
                            <button 
                              onClick={() => setIsDeleting(false)}
                              className="flex-1 py-2 bg-white/10 text-white text-[10px] font-bold rounded-lg uppercase tracking-widest"
                            >
                              Cancel
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="grid grid-cols-2 gap-2 mb-4">
                      <div className="p-2 bg-white/5 rounded-lg border border-white/5">
                        <p className="text-[8px] opacity-30 uppercase">Age</p>
                        <p className="text-xs">{selectedAvatar.age}</p>
                      </div>
                      <div className="p-2 bg-white/5 rounded-lg border border-white/5">
                        <p className="text-[8px] opacity-30 uppercase">Gender</p>
                        <p className="text-xs truncate">{selectedAvatar.gender}</p>
                      </div>
                      <div className="p-2 bg-white/5 rounded-lg border border-white/5">
                        <p className="text-[8px] opacity-30 uppercase">Race</p>
                        <p className="text-xs truncate">{selectedAvatar.race}</p>
                      </div>
                      <div className="p-2 bg-white/5 rounded-lg border border-white/5">
                        <p className="text-[8px] opacity-30 uppercase">Occupation</p>
                        <p className="text-xs truncate">{selectedAvatar.occupation}</p>
                      </div>
                    </div>

                    <div className="p-4 bg-white/5 rounded-2xl border border-white/5 mb-6">
                      {selectedAvatar.uid === user?.uid ? (
                        <p className="text-xs font-light leading-relaxed text-white/80 italic">
                          "{selectedAvatar.description}"
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[8px] opacity-30 uppercase tracking-widest">who is this person?</p>
                          {isSummarizing ? (
                            <div className="flex items-center gap-2 py-2">
                              <Loader2 size={10} className="animate-spin opacity-40" />
                              <span className="text-[10px] opacity-40 italic">fetching personality...</span>
                            </div>
                          ) : (
                            <p className="text-xs font-light leading-relaxed text-emerald-400/80 italic">
                              "{avatarSummary}"
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {selectedAvatar.currentStatus && (
                      <div className="mb-8">
                        <p className="text-[10px] opacity-40 uppercase tracking-widest mb-2">Current State</p>
                        <p className="text-sm font-light text-emerald-400/90 leading-relaxed">
                          {selectedAvatar.currentStatus}
                        </p>
                      </div>
                    )}

                    {/* Life Log Section */}
                    {selectedAvatar.uid === user?.uid && (
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <p className="text-[10px] opacity-40 uppercase tracking-widest">Life Log</p>
                          {isGeneratingLogs && (
                            <div className="flex items-center gap-2">
                              <Loader2 size={10} className="animate-spin opacity-40" />
                              <span className="text-[8px] opacity-40 uppercase tracking-widest">Living...</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="relative space-y-6 pl-4 border-l border-white/10 ml-1">
                          {lifeLogs.length > 0 ? (
                            lifeLogs.map((log) => (
                              <div key={log.id} className="relative">
                                {/* Timeline Dot */}
                                <div className="absolute -left-[21px] top-1 w-2 h-2 rounded-full bg-white/20 border border-black" />
                                
                                <div className="p-4 bg-white/5 rounded-2xl border border-white/5 hover:bg-white/10 transition-all">
                                  <p className="text-[8px] opacity-30 uppercase mb-1">
                                    {format(new Date(log.timestamp), 'MMMM d, yyyy — h:mm a')}
                                  </p>
                                  <p className="text-xs font-light leading-relaxed text-white/80">
                                    {log.text}
                                  </p>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="p-8 text-center border border-dashed border-white/10 rounded-2xl -ml-4">
                              <p className="text-[10px] opacity-30 uppercase tracking-widest">No entries yet</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </>
      )}
      </div>
    </div>
  );
}
