import { useState, useEffect, type FC } from 'react';

interface CircularGalleryProps {
    textColor?: string;
}

const galleryItems = [
    { id: 1, emoji: 'S', label: 'Discover' },
    { id: 2, emoji: 'A', label: 'Analyze' },
    { id: 3, emoji: 'E', label: 'Automate' },
    { id: 4, emoji: 'P', label: 'Protect' },
    { id: 5, emoji: 'C', label: 'Scale' },
    { id: 6, emoji: 'T', label: 'Target' },
];

const CircularGallery: FC<CircularGalleryProps> = ({ textColor = '#18181b' }) => {
    const [rotation, setRotation] = useState(0);
    const [isHovered, setIsHovered] = useState<number | null>(null);

    // Auto-rotate animation
    useEffect(() => {
        const interval = setInterval(() => {
            setRotation(prev => prev + 0.5);
        }, 50);
        return () => clearInterval(interval);
    }, []);

    const radius = 140;
    const centerX = 200;
    const centerY = 200;

    return (
        <div className="circular-gallery">
            <div className="circular-gallery__container" style={{ width: 400, height: 400 }}>
                {/* Center content */}
                <div
                    className="circular-gallery__center"
                    style={{
                        background: 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                        color: textColor
                    }}
                >
                    <span style={{ fontSize: '2rem', fontWeight: 800 }}>BugSafari</span>
                </div>

                {/* Rotating items */}
                {galleryItems.map((item, index) => {
                    const angle = (index * (360 / galleryItems.length)) + rotation;
                    const radian = (angle * Math.PI) / 180;
                    const x = centerX + radius * Math.cos(radian) - 40;
                    const y = centerY + radius * Math.sin(radian) - 40;

                    return (
                        <div
                            key={item.id}
                            className="circular-gallery__item"
                            onMouseEnter={() => setIsHovered(item.id)}
                            onMouseLeave={() => setIsHovered(null)}
                            style={{
                                left: x,
                                top: y,
                                transform: isHovered === item.id ? 'scale(1.15)' : 'scale(1)',
                                background: 'var(--color-surface)',
                                borderColor: 'var(--color-border)',
                                color: textColor,
                            }}
                        >
                            <span style={{ fontSize: '1.5rem' }}>{item.emoji}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default CircularGallery;
