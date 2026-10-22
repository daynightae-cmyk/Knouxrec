import React, { useState, useRef, useEffect } from 'react';
import { Recording } from '../types';
import { CloseIcon, CutIcon, DownloadIcon } from './icons';
import RangeSlider from './RangeSlider';

interface TrimModalProps {
  recording: Recording;
  onSave: (recording: Recording, trimData: { start: number; end: number }) => void;
  onSaveFull: (recording: Recording) => void;
  onClose: () => void;
}

const formatTime = (time: number) => {
  const date = new Date(0);
  date.setSeconds(time);
  return date.toISOString().substr(14, 5);
};

const TrimModal: React.FC<TrimModalProps> = ({ recording, onSave, onSaveFull, onClose }) => {
  const [duration, setDuration] = useState(0);
  const [trimRange, setTrimRange] = useState<[number, number]>([0, 0]);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      const onMetadataLoaded = () => {
        const videoDuration = videoRef.current!.duration;
        setDuration(videoDuration);
        setTrimRange([0, videoDuration]);
      };
      videoRef.current.addEventListener('loadedmetadata', onMetadataLoaded);
      return () => videoRef.current?.removeEventListener('loadedmetadata', onMetadataLoaded);
    }
  }, [recording]);

  const handleTrimChange = (newRange: [number, number]) => {
    setTrimRange(newRange);
    if(videoRef.current) {
        videoRef.current.currentTime = newRange[0];
    }
  };
  
  const handleSaveTrimmed = () => {
    onSave(recording, { start: trimRange[0], end: trimRange[1] });
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-lg flex items-center justify-center z-50" onClick={onClose}>
      <div className="glass-card w-full max-w-2xl p-6 relative rounded-2xl border-2 border-knoux-purple/50" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-orbitron font-bold text-knoux-purple">Instant Trim</h2>
          <button onClick={onClose} className="text-[var(--secondary-text)] hover:text-white transition-colors">
            <CloseIcon className="w-6 h-6"/>
          </button>
        </div>

        <video ref={videoRef} src={recording.url} controls className="w-full h-auto max-h-[60vh] rounded-lg bg-black"></video>

        <div className="my-6">
            <div className="flex justify-between text-sm font-mono text-[var(--secondary-text)] mb-2">
                <span>{formatTime(trimRange[0])}</span>
                <span>{formatTime(trimRange[1])}</span>
            </div>
            {duration > 0 && (
                <RangeSlider
                    min={0}
                    max={duration}
                    value={trimRange}
                    onChange={handleTrimChange}
                    step={0.1}
                />
            )}
        </div>
        
        <div className="flex justify-end items-center gap-4">
            <button
                onClick={() => onSaveFull(recording)}
                className="flex items-center gap-2 px-4 py-2 text-md font-bold font-rajdhani bg-gray-600/50 text-white rounded-lg hover:bg-gray-500/50 transition-all duration-300"
            >
                <DownloadIcon className="w-5 h-5" />
                Save Full Video
            </button>
            <button
                onClick={handleSaveTrimmed}
                className="flex items-center gap-2 px-6 py-2 text-lg font-bold font-orbitron bg-knoux-neon-blue text-knoux-dark-glass rounded-lg shadow-[0_0_20px_rgba(0,217,255,0.5)] hover:bg-white transition-all duration-300"
            >
                <CutIcon className="w-5 h-5" />
                Save Trimmed
            </button>
        </div>

      </div>
    </div>
  );
};

export default TrimModal;
