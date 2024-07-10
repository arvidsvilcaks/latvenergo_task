const express = require('express');
const bodyParser = require('body-parser');
const bodyParserXml = require('body-parser-xml');
const js2xmlparser = require('js2xmlparser');
const https = require('https');

const app = express();
const port = 3055;

// Initialize XML body parser
bodyParserXml(bodyParser);

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.xml({
    xmlParseOptions: {
        normalize: true,
        normalizeTags: true,
        explicitArray: false
    }
}));

const parseRequestBody = (req, res, next) => {
    const contentType = req.headers['content-type'];
    if (contentType && contentType.includes('xml')) {
        next();
    } else {
        bodyParser.json()(req, res, next);
    }
};

const formatResponse = (req, res, next) => {
    res.format({
        'application/json': () => {
            res.json(res.locals.responseBody);
        },
        'application/xml': () => {
            const xml = js2xmlparser.parse("response", res.locals.responseBody);
            res.type('application/xml').send(xml);
        },
        'default': () => {
            res.json(res.locals.responseBody);
        }
    });
};

// Logging middleware for incoming requests
app.use((req, res, next) => {
    const logEntry = {
        type: 'messageIn',
        body: JSON.stringify(req.body),
        method: req.method,
        path: req.originalUrl,
        dateTime: new Date().toISOString()
    };
    console.log('Incoming request:', logEntry);
    next();
});

// Error handling middleware for JSON parsing errors
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        const errorResponse = {
            type: 'messageOut',
            body: err.body,
            dateTime: new Date().toISOString(),
            fault: err.stack || 'No stack trace available'
        };
        console.log('Error response:', errorResponse);
        res.locals.responseBody = errorResponse;
        return formatResponse(req, res, next);
    }
    next(err);
});

// Logging middleware for outgoing responses
app.use((req, res, next) => {
    const originalJson = res.json;
    res.json = function(body) {
        const logEntryOut = {
            type: 'messageOut',
            body: JSON.stringify(body),
            dateTime: new Date().toISOString(),
            fault: body.code >= 400 ? (body.fault || 'No error occurred') : undefined
        };
        console.log('Outgoing response:', logEntryOut);
        originalJson.call(this, body);
    };
    next();
});

app.post('/search', parseRequestBody, (req, res, next) => {
    const { query, page = 1 } = req.body;
    const errorMessages = [];

    if (typeof query !== 'string') {
        errorMessages.push('Query must be a string.');
    } else if (query.length < 3 || query.length > 10) {
        errorMessages.push('Query length must be between 3 and 10 characters.');
    }

    if (typeof page !== 'number') {
        errorMessages.push('Page must be a number.');
    } else if (page < 1) {
        errorMessages.push('Page must be greater than or equal to 1.');
    }

    if (errorMessages.length > 0) {
        const errorResponse = {
            code: 400,
            message: errorMessages.join(' ')
        };
        console.log('Validation error response:', errorResponse);
        res.locals.responseBody = errorResponse;
        return formatResponse(req, res, next);
    }

    const pageSize = 2;
    const skip = (page - 1) * pageSize;

    https.get(`https://dummyjson.com/products/search?q=${query}&limit=${pageSize}&skip=${skip}`, (response) => {
        let data = '';

        response.on('data', (chunk) => {
            data += chunk;
        });

        response.on('end', () => {
            try {
                const products = JSON.parse(data).products;
                const transformedProducts = products.map(product => {
                    const discount = product.price * (product.discountPercentage / 100);
                    const finalPrice = (product.price - discount).toFixed(2);
                    return {
                        title: product.title,
                        description: product.description,
                        final_price: parseFloat(finalPrice)
                    };
                });

                res.locals.responseBody = transformedProducts;
                formatResponse(req, res, next);
            } catch (error) {
                console.error('Error parsing response:', error);
                const errorResponse = {
                    code: 500,
                    message: 'Failed to parse response from external API',
                    fault: error.stack || 'No stack trace available'
                };
                console.log('Error response:', errorResponse);
                res.locals.responseBody = errorResponse;
                formatResponse(req, res, next);
            }
        });

    }).on('error', (err) => {
        console.error('Error fetching data:', err);
        const errorResponse = {
            code: 500,
            message: 'Failed to fetch products from external API',
            fault: err.stack || 'No stack trace available'
        };
        console.log('Error response:', errorResponse);
        res.locals.responseBody = errorResponse;
        formatResponse(req, res, next);
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});
