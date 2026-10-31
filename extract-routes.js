import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Extract route paths from App.tsx
 * @param {Object} options - Configuration options
 * @param {string} options.routeFilePath - Route file path (relative to project root), default 'src/App.tsx'
 * @param {string[]} options.excludeList - Routes to exclude, default []
 * @param {boolean} options.excludeDynamic - Whether to exclude dynamic routes (containing :), default true
 * @returns {string[]} Filtered route paths array
 */
export function extractRoutes(options = {}) {
  const {
    routeFilePath = 'src/App.tsx',
    excludeList = [],
    excludeDynamic = true
  } = options;

  try {
    // Read route file
    const filePath = join(__dirname, routeFilePath);
    const content = readFileSync(filePath, 'utf-8');
    
    // Extract all path attributes using regex
    const pathRegex = /<Route\s+path="([^"]+)"/g;
    const routes = [];
    let match;
    
    while ((match = pathRegex.exec(content)) !== null) {
      routes.push(match[1]);
    }
    
    // Filter routes
    const filteredRoutes = routes.filter(route => {
      // Exclude dynamic routes (containing :)
      if (excludeDynamic && route.includes(':')) {
        return false;
      }
      
      // Exclude routes in exclusion list
      if (excludeList.includes(route)) {
        return false;
      }
      
      return true;
    });
    
    // Remove duplicates
    const uniqueRoutes = [...new Set(filteredRoutes)];
    
    console.log('✅ Successfully extracted routes:', uniqueRoutes);
    console.log('📊 Extraction statistics - Total:', routes.length, '| Filtered:', uniqueRoutes.length, '| Excluded:', routes.length - uniqueRoutes.length);
    
    return uniqueRoutes;
  } catch (error) {
    console.error('❌ Error extracting routes:', error.message);
    console.error('File path:', routeFilePath);
    // Return empty array on error, let plugin use default behavior
    return [];
  }
}

