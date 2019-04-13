FROM mhart/alpine-node:10.15.3
# Create app directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
ENV PORT 80
ENV PING_INTERVAL 5000
ENV PING_TIMEOUT 15000
ADD ./ /usr/src/app/
RUN npm install

EXPOSE ${PORT}
CMD [ "node", "index.js" ]
