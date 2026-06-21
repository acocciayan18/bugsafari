import { type FC } from 'react';

interface ChromaGridProps {
    borderColor?: string;
    gradient?: string;
}

const gridItems = [
    { title: 'Join Community', description: 'Connect with 10,000+ developers', stat: '10K+' },
    { title: 'Open Source', description: 'Contribute and grow', stat: '500+' },
    { title: 'Bug Reports', description: 'Helped fix millions of bugs', stat: '1M+' },
    { title: 'Happy Users', description: 'Satisfied developers', stat: '98%' },
];

const ChromaGrid: FC<ChromaGridProps> = ({
    borderColor = '#ba5a5a',
    gradient = 'linear-gradient(135deg, #ba5a5a 0%, #f7e49b 100%)'
}) => {
    return (
        <div className="chroma-grid" style={{ borderColor }}>
            {gridItems.map((item, index) => (
                <div
                    key={index}
                    className="chroma-grid__item"
                    style={{ background: gradient }}
                >
                    <span style={{ fontSize: '2rem', fontWeight: 800 }}>{item.stat}</span>
                    <span style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>{item.title}</span>
                </div>
            ))}
        </div>
    );
};

export default ChromaGrid;
