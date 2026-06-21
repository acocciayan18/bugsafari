import { type FC } from 'react';

interface FlowingMenuProps {
    bgColor?: string;
    marqueeBgColor?: string;
    textColor?: string;
}

const menuItems = [
    'Autonomous Testing',
    'Real-time Forensics',
    'ML Bug Detection',
    'Scriptless SPA Crawling',
    'Risk Scoring',
    'Zero Setup',
    'Auto Recovery',
    'Continuous Learning',
];

const FlowingMenu: FC<FlowingMenuProps> = ({
    bgColor = '#ffffff',
    marqueeBgColor = '#ba5a5a',
    textColor = '#18181b'
}) => {
    // Duplicate items for seamless marquee loop
    const duplicatedItems = [...menuItems, ...menuItems];

    return (
        <div className="flowing-menu" style={{ background: bgColor }}>
            <div className="flowing-menu__marquee">
                {duplicatedItems.map((item, index) => (
                    <div
                        key={index}
                        className="flowing-menu__item"
                        style={{ color: textColor }}
                    >
                        <span
                            style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: marqueeBgColor
                            }}
                        />
                        {item}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default FlowingMenu;
